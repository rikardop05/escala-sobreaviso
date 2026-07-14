import { useMemo } from 'react';
import {
  PEOPLE, WEEKDAY_SHIFTS, WEEKEND_ROSTER, WEEKEND_CHANGE, MS_DAY,
  weekendAssignment, shiftPeople,
} from '../lib/schedule';
import { getTheme } from '../lib/theme';
import { Icon } from './ui';

// Pilha visual de uma pessoa numa célula da tabela (mesmo visual dos badges do app).
function Pessoa({ name, T }) {
  const p = PEOPLE[name] || { color: '#64748B', bg: '#E2E8F0' };
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-sm font-bold" style={{ color: p.color, background: p.bg }}>
      <span className="w-2 h-2 rounded-full" style={{ background: p.color, flexShrink: 0 }} />
      {name}
    </span>
  );
}

const WEEKDAY_COLS = [
  { dow: 1, label: 'Seg' }, { dow: 2, label: 'Ter' }, { dow: 3, label: 'Qua' },
  { dow: 4, label: 'Qui' }, { dow: 5, label: 'Sex' },
];

// Proposta de estrutura em avaliação — inclui a Alice na semana, sem mexer em
// Ricardo/Emanoel/Carlos: Seg Madrugada (era Raul) e Qui Manhã (era Marcus Túlio).
// Só afeta esta tela; WEEKDAY_SHIFTS (calendário real e cálculo financeiro do CH)
// continua intocado até a mudança ser aprovada e aplicada de fato.
const WEEKDAY_DISPLAY_OVERRIDES = {
  1: { 0: 'Alice' }, // Segunda · Madrugada
  4: { 1: 'Alice' }, // Quinta · Manhã
};

export default function EstruturaEscala({ dark }) {
  const T = getTheme(dark);

  // Semana: 3 turnos (linhas) × 5 dias (colunas). Horário/duração vêm do turno de segunda;
  // a única exceção é a Noite de sexta (até 24:00) — sinalizada com asterisco.
  const weekdayRows = useMemo(() => {
    const base = WEEKDAY_SHIFTS[1]; // Madrugada, Manhã, Noite
    return base.map((ref, i) => ({
      period: ref.period,
      time: ref.time,
      dur: ref.dur,
      cells: WEEKDAY_COLS.map(c => {
        const shift = WEEKDAY_SHIFTS[c.dow][i];
        const override = WEEKDAY_DISPLAY_OVERRIDES[c.dow]?.[i];
        return override ? { ...shift, person: override } : shift;
      }),
    }));
  }, []);

  // Fim de semana: escada de 6 semanas gerada do roster (vigente a partir de WEEKEND_CHANGE).
  const weekendRows = useMemo(() => {
    return Array.from({ length: WEEKEND_ROSTER.length }, (_, w) => {
      const sat = new Date(WEEKEND_CHANGE.getTime() + w * 7 * MS_DAY);
      return weekendAssignment(sat);
    });
  }, []);

  const th = { textAlign: 'left', fontSize: '0.72rem', fontWeight: 700, color: T.labelColor, padding: '0.6rem 0.75rem', whiteSpace: 'nowrap', borderBottom: `1px solid ${T.cardBorder}` };
  const td = { padding: '0.55rem 0.75rem', borderTop: `1px solid ${T.divider}`, whiteSpace: 'nowrap' };
  const cardStyle = { background: T.cardBg, border: `1px solid ${T.cardBorder}`, borderRadius: '1rem', overflow: 'hidden' };

  const changeStr = `${String(WEEKEND_CHANGE.getDate()).padStart(2, '0')}/${String(WEEKEND_CHANGE.getMonth() + 1).padStart(2, '0')}/${WEEKEND_CHANGE.getFullYear()}`;

  return (
    <div style={{ minHeight: '100vh', background: T.pageBg, fontFamily: "'Segoe UI',system-ui,sans-serif", color: T.textPrimary, transition: 'background 0.2s,color 0.2s' }}>
      <div className="max-w-3xl mx-auto px-4 py-6">

        {/* CABEÇALHO */}
        <header className="rounded-2xl p-5 mb-5 text-white" style={{ background: T.headerGrad }}>
          <h1 className="text-sm font-semibold opacity-80 mb-1" style={{ letterSpacing: '0.01em' }}>Estrutura da Escala</h1>
          <div className="text-2xl font-bold">Semana e fim de semana</div>
          <div className="text-sm opacity-80 mt-1">Visão da estrutura vigente do rodízio · somente leitura</div>
        </header>

        <p className="flex items-start gap-1.5 text-xs mb-5" style={{ color: T.textMuted }}>
          <Icon name="alert" size={13} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
          <span>Esta tela mostra a <b style={{ color: T.textSecondary }}>estrutura base</b> do rodízio. Trocas eventuais, feriados e ajustes de um dia específico continuam na aba <b style={{ color: T.textSecondary }}>Escala</b>. A edição da estrutura aqui chega numa próxima etapa.</span>
        </p>

        {/* SEMANA */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold mb-2" style={{ color: T.textSecondary }}>Semana (seg – sex)</h2>
          <div style={cardStyle}>
            <div style={{ overflowX: 'auto' }}>
              <table className="w-full" style={{ borderCollapse: 'collapse', minWidth: '560px' }}>
                <thead>
                  <tr>
                    <th style={th} scope="col">Turno</th>
                    {WEEKDAY_COLS.map(c => <th key={c.dow} style={th} scope="col">{c.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {weekdayRows.map((row, i) => (
                    <tr key={i}>
                      <th scope="row" style={{ ...td, textAlign: 'left' }}>
                        <div className="font-semibold" style={{ color: T.textPrimary }}>{row.period}</div>
                        <div className="font-mono text-xs" style={{ color: T.textMuted }}>{row.time} · {row.dur}{row.period === 'Noite' ? ' *' : ''}</div>
                      </th>
                      {row.cells.map((shift, ci) => (
                        <td key={ci} style={td}>
                          {shiftPeople(shift).map((n, k) => <Pessoa key={k} name={n} T={T} />)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-xs mt-2" style={{ color: T.textMuted }}>* Noite de sexta vai até 24:00 (6h); nos demais dias, até 23:00 (5h).</p>
        </section>

        {/* FIM DE SEMANA */}
        <section>
          <h2 className="text-sm font-semibold mb-2" style={{ color: T.textSecondary }}>Fim de semana — escada de 6 semanas</h2>
          <div style={cardStyle}>
            <div style={{ overflowX: 'auto' }}>
              <table className="w-full" style={{ borderCollapse: 'collapse', minWidth: '620px' }}>
                <thead>
                  <tr>
                    <th style={th} scope="col">Semana</th>
                    <th style={th} scope="col">Sáb Dia<br /><span className="font-mono" style={{ fontWeight: 400 }}>00:00–12:00</span></th>
                    <th style={th} scope="col">Sáb Noite<br /><span className="font-mono" style={{ fontWeight: 400 }}>12:00–00:00</span></th>
                    <th style={th} scope="col">Dom Dia<br /><span className="font-mono" style={{ fontWeight: 400 }}>00:00–12:00</span></th>
                    <th style={th} scope="col">Dom Noite<br /><span className="font-mono" style={{ fontWeight: 400 }}>12:00–00:00</span></th>
                    <th style={th} scope="col">Folga</th>
                  </tr>
                </thead>
                <tbody>
                  {weekendRows.map((r, i) => (
                    <tr key={i}>
                      <th scope="row" style={{ ...td, textAlign: 'left', color: T.textMuted, fontWeight: 700 }}>{i + 1}</th>
                      <td style={td}><Pessoa name={r.sabDia} T={T} /></td>
                      <td style={td}><Pessoa name={r.sabNoite} T={T} /></td>
                      <td style={td}><Pessoa name={r.domDia} T={T} /></td>
                      <td style={td}><Pessoa name={r.domNoite} T={T} /></td>
                      <td style={td}>
                        <span className="inline-flex flex-wrap gap-1">
                          {r.folga.map((n, k) => <Pessoa key={k} name={n} T={T} />)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-xs mt-2" style={{ color: T.textMuted }}>Cada pessoa avança uma coluna por semana (Sáb Dia → Sáb Noite → Dom Dia → Dom Noite → Folga → Folga). Vigente a partir de {changeStr}.</p>
        </section>

      </div>
    </div>
  );
}
