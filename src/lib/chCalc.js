// Cálculo financeiro do Controle de Horas — extraído de ControleDeHoras.jsx para que o
// relatório consolidado (RelatorioConsolidado.jsx) use exatamente a mesma fórmula, sem
// duplicá-la em dois lugares (duplicar lógica de pagamento é como esse tipo de número
// diverge sem ninguém perceber). Nenhuma fórmula muda aqui — é a mesma de sempre:
//
//   valorHora       = remuneracao / jornada
//   valorSobreaviso = (valorHora / 3)   × horasSA      ← horas ÍNTEGRAS da escala, sem
//                                                          descontar horas de HE
//   valorHoraExtra  = (valorHora × 1.5) × horasHE
//   valorComp       = (valorHora / 3)   × horasComp    ← mesmo fator do SA, abate do total
import { durationHours, mergedHours, resolveShiftPeople, dayKey } from './schedule';

// Extrai HH:MM de uma string de turno ex: "23:00 – 04:00".
// Aceita en-dash (–), em-dash (—) e hífen (-) — o admin pode digitar qualquer um ao
// editar a escala; sem isso o split falharia e a duração viraria 0h silenciosamente.
export function parseShiftTime(timeStr) {
  const parts = String(timeStr).split(/[–—-]/).map(t => t.trim());
  return { inicio: parts[0], fim: parts[1] };
}

// Sobreaviso gerado pela escala para `person` no mês (monthIdx/year), já com
// substituições resolvidas (resolveShiftPeople — mesma regra do calendário, incluindo
// "edição vence substituição"). Cada pessoa de um turno multi-pessoa (feriado) gera
// seu próprio lançamento.
export function scheduleEntriesFor(schedule, subs, person, monthIdx, year) {
  if (!person) return [];
  return schedule
    .filter(day => day.date.getMonth() === monthIdx && day.date.getFullYear() === year)
    .flatMap(day => {
      const dk = dayKey(day.date);
      return day.shifts.flatMap(shift => {
        const { inicio, fim } = parseShiftTime(shift.time);
        return resolveShiftPeople(shift, dk, subs).flatMap(({ person: effective, coveringFor: coveredTitular, titular }) => {
          if (effective !== person) return [];
          return [{
            id: `sched-${dk}-${shift.period}-${titular}`,
            person,
            tipo: 'Sobreaviso',
            data: dk,
            inicio,
            fim,
            projeto: '',
            atividade: coveredTitular ? `${shift.period} · cobre ${coveredTitular}` : shift.period,
            _fromSchedule: true,
          }];
        });
      });
    });
}

// Totais do mês a partir da lista combinada (SA da escala + HE/Comp manuais).
// SA vem da escala (turnos sequenciais, não se sobrepõem) → soma direta. HE e Comp são
// manuais e podem colidir → mescla a união pra não contar a mesma hora em dobro.
export function monthTotals(allMonthEntries, valorHora) {
  const byType = { Sobreaviso: [], 'Hora Extra': [], 'Compensação': [] };
  allMonthEntries.forEach(e => { if (byType[e.tipo]) byType[e.tipo].push(e); });
  const sumRaw = (list) => list.reduce((a, e) => a + durationHours(e.inicio, e.fim), 0);

  const sobreaviso = sumRaw(byType['Sobreaviso']);
  const extra = mergedHours(byType['Hora Extra']);
  const comp = mergedHours(byType['Compensação']);
  // Tempo "economizado" pela mescla — só para avisar o usuário (total ≠ soma das linhas).
  const overlapMin = Math.round(((sumRaw(byType['Hora Extra']) - extra) + (sumRaw(byType['Compensação']) - comp)) * 60);

  const valorSobreaviso = (valorHora / 3) * sobreaviso;
  const valorExtra = valorHora * 1.5 * extra;
  // Compensação abate do total pelo mesmo valor do sobreaviso (÷3) — não tem multiplicador próprio.
  const valorComp = (valorHora / 3) * comp;
  return {
    sobreaviso, extra, comp,
    totalHoras: sobreaviso + extra + comp,
    valorSobreaviso, valorExtra, valorComp,
    valorTotal: valorSobreaviso + valorExtra, // não desconta compensação — ver "Valor da NF" em ControleDeHoras.jsx
    overlapMin,
  };
}
