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
// Extensão .js explícita: este módulo agora também é importado por api/ch.js,
// que roda em Node puro (Vercel) — sem bundler, extensão é obrigatória na
// resolução de import relativo (Vite tolera a omissão; Node não).
import { durationHours, mergedHours, resolveShiftPeople, buildOnCallSegments, getActiveSub, dayKey } from './schedule.js';

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

// ─── APROVAÇÃO DE EXCEDENTE (Hora Extra) ────────────────────────────────────
// Um lançamento de Hora Extra é comparado com a união do sobreaviso EFETIVO da
// pessoa naquela data — a parte dentro do sobreaviso é aprovada automaticamente;
// a parte fora ("excedente") vira lançamento pendente até um admin decidir.
// Sobreaviso e Compensação nunca passam por isto.

// Um lançamento sujeito a aprovação só entra nos totais quando aprovado — ou é
// legado, sem `status` (compatibilidade: dado gravado antes desta feature conta
// como sempre contou, sem precisar de migração). Pendente e rejeitado ficam de
// fora de TODOS os totais (mês, Valor da NF, CSV, relatório consolidado,
// snapshot de fechamento) — nunca reclassifica, só filtra o que já foi decidido.
export function isEntryCountable(entry) {
  return entry.status === undefined || entry.status === 'aprovado';
}

function toMin(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

function fmtMin(min) {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

// buildOnCallSegments não depende de pessoa nem de substituição (a filtragem por
// pessoa acontece em saWindowsRelativeToDate, depois) — só de (schedule, dayStart).
// api/ch.js chama splitHoraExtra uma vez por Hora Extra reclassificada num mesmo
// POST, sempre com a MESMA referência de `schedule` (construída uma vez por
// requisição); sem isto, um lote reconstruiria os ~1050 segmentos da vigência a
// cada lançamento. WeakMap com `schedule` como chave — nunca vaza memória entre
// requisições, já que a referência do array some com o fim de cada uma.
const segmentsCache = new WeakMap();
function cachedSegments(schedule, dayStart) {
  let byDayStart = segmentsCache.get(schedule);
  if (!byDayStart) {
    byDayStart = new Map();
    segmentsCache.set(schedule, byDayStart);
  }
  let segs = byDayStart.get(dayStart);
  if (!segs) {
    segs = buildOnCallSegments(schedule, dayStart);
    byDayStart.set(dayStart, segs);
  }
  return segs;
}

// União (mesclada, ordenada) das janelas de sobreaviso EFETIVO de `person`, em
// minutos relativos à meia-noite de `data` — pode ter valores negativos (turno
// pernoite da véspera, ADR-0002) ou >= 1440 (turno que vira para o dia seguinte).
// Usa buildOnCallSegments (que já resolve pernoite via dayStart) e getActiveSub
// (substituição) — nunca reimplementa essas regras, só reaproveita.
function saWindowsRelativeToDate(schedule, subs, dayStart, person, data) {
  const segs = cachedSegments(schedule, dayStart);
  const anchorMs = new Date(`${data}T00:00:00`).getTime();
  const windows = [];
  for (const seg of segs) {
    for (const titular of seg.people) {
      // Turno travado por override não redireciona por substituição — mesma
      // regra "edição vence substituição" do calendário (resolveShiftPeople).
      const sub = seg.personsOverridden ? null : getActiveSub(titular, seg.dateStr, subs);
      const effective = sub ? sub.substituto : titular;
      if (effective !== person) continue;
      windows.push([(seg.start - anchorMs) / 60000, (seg.end - anchorMs) / 60000]);
    }
  }
  windows.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [s, e] of windows) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

// Compara [inicio,fim) de uma Hora Extra em `data` com o sobreaviso efetivo de
// `person` (resolvido a partir de `schedule`/`subs`/`dayStart` — a mesma escala
// que o calendário e o CH já usam) e devolve as partes resultantes, em ordem
// cronológica: [{ data, inicio, fim, aprovado }]. Um lançamento pode gerar N
// partes (uma por trecho dentro/fora do sobreaviso). `data` de uma parte que cai
// inteiramente no dia seguinte é ajustada (+1 dia) — mesma convenção de
// durationHours (fim <= início soma 24h) para partes que só cruzam a virada.
export function splitHoraExtra(schedule, subs, dayStart, person, data, inicio, fim) {
  const heStart = toMin(inicio);
  let heEnd = toMin(fim);
  if (heEnd <= heStart) heEnd += 1440; // cruza a meia-noite — convenção existente

  const saWindows = saWindowsRelativeToDate(schedule, subs, dayStart, person, data);
  const clipped = saWindows
    .map(([s, e]) => [Math.max(s, heStart), Math.min(e, heEnd)])
    .filter(([s, e]) => e > s);

  const parts = [];
  let cursor = heStart;
  for (const [s, e] of clipped) {
    if (s > cursor) parts.push({ start: cursor, end: s, aprovado: false });
    parts.push({ start: Math.max(s, cursor), end: e, aprovado: true });
    cursor = Math.max(cursor, e);
  }
  if (cursor < heEnd) parts.push({ start: cursor, end: heEnd, aprovado: false });

  return parts
    .filter(p => p.end > p.start)
    .map(p => (
      p.start >= 1440
        ? { data: addDays(data, 1), inicio: fmtMin(p.start), fim: fmtMin(p.end), aprovado: p.aprovado }
        : { data, inicio: fmtMin(p.start), fim: fmtMin(p.end), aprovado: p.aprovado }
    ));
}
