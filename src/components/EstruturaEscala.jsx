import { useMemo, useState } from 'react';
import {
  PEOPLE, WEEKDAY_SHIFTS, WEEKEND_ROSTER, WEEKEND_CHANGE, MS_DAY,
  weekendAssignment, shiftPeople, blocosAtivos, dayKey, parseTimeRange, shiftDuration,
} from '../lib/schedule';
import { TEAMS } from '../lib/teams';
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

// Semana cheia (para infra/desenvolvimento, que cobrem os 7 dias) — ordem Seg→Dom,
// mais legível como referência do que a numeração dow do motor (Dom=0).
const FULL_WEEK = [
  { dow: 1, label: 'Segunda' }, { dow: 2, label: 'Terça' }, { dow: 3, label: 'Quarta' },
  { dow: 4, label: 'Quinta' }, { dow: 5, label: 'Sexta' }, { dow: 6, label: 'Sábado' }, { dow: 0, label: 'Domingo' },
];

// Proposta de estrutura em avaliação — inclui a Alice na semana, sem mexer em
// Ricardo/Emanoel/Carlos: Seg Madrugada (era Raul) e Qui Manhã (era Marcus Túlio).
// Só afeta esta tela; WEEKDAY_SHIFTS (calendário real e cálculo financeiro do CH)
// continua intocado até a mudança ser aprovada e aplicada de fato.
const WEEKDAY_DISPLAY_OVERRIDES = {
  1: { 0: 'Alice' }, // Segunda · Madrugada
  4: { 1: 'Alice' }, // Quinta · Manhã
};

const fmtMin = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// Faixas SEM cobertura de um dia, a partir dos turnos declarados (complemento das
// 24h). Genérico — não depende de conhecer de antemão os horários de cada equipe.
function coverageGaps(shifts) {
  const intervals = shifts.map(s => {
    const tr = parseTimeRange(s.time);
    if (!tr) return null;
    let start = tr.sh * 60 + tr.sm, end = tr.eh * 60 + tr.em;
    if (end <= start) end += 1440;
    return [start, end];
  }).filter(Boolean).sort((a, b) => a[0] - b[0]);

  const gaps = [];
  let cursor = 0;
  for (const [s, e] of intervals) {
    if (s > cursor) gaps.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < 1440) gaps.push([cursor, 1440]);
  return gaps.map(([s, e]) => `${fmtMin(s)}–${fmtMin(e)}`);
}

// Equipes que a pessoa administra — só essas aparecem no seletor. adminOf === '*'
// (admin de tudo) vê as três; um array vazio nunca chega aqui (a aba some antes,
// em App.jsx) mas o fallback abaixo evita uma tela em branco se isso mudar.
function allowedTeamIds(profile) {
  if (profile?.adminOf === '*') return Object.keys(TEAMS);
  if (Array.isArray(profile?.adminOf)) return profile.adminOf.filter(id => TEAMS[id]);
  return [];
}

export default function EstruturaEscala({ dark, profile }) {
  const T = getTheme(dark);
  const allowed = allowedTeamIds(profile);
  const [selectedTeamId, setSelectedTeamId] = useState(() => (allowed.includes('sustentacao') ? 'sustentacao' : allowed[0]));
  const teamId = allowed.includes(selectedTeamId) ? selectedTeamId : allowed[0];
  const team = teamId ? TEAMS[teamId] : null;

  // A tabela mostra a estrutura VIGENTE HOJE: entradas de WEEKDAY_SHIFTS podem ter
  // vigência por data (ver blocosAtivos), então resolver sem uma data mostraria turnos
  // que já saíram de vigência — ou dois turnos para o mesmo horário.
  const hojeStr = dayKey(new Date());

  // Semana: 3 turnos (linhas) × 5 dias (colunas). Horário/duração vêm do turno de segunda;
  // se algum dia divergir da referência, a linha é sinalizada com asterisco.
  const weekdayRows = useMemo(() => {
    const base = blocosAtivos(WEEKDAY_SHIFTS, 1, hojeStr); // Madrugada, Manhã, Noite
    return base.map((ref, i) => ({
      period: ref.period,
      time: ref.time,
      dur: shiftDuration(ref.time), // derivado, nunca armazenado (defeito §7.6)
      // Dias cujo horário difere da referência de segunda (hoje: nenhum; antes de
      // 2026-08-01, a Noite de sexta ia até 24:00).
      excecoes: WEEKDAY_COLS
        .map(c => ({ c, s: blocosAtivos(WEEKDAY_SHIFTS, c.dow, hojeStr)[i] }))
        .filter(({ s }) => s && s.time !== ref.time)
        .map(({ c, s }) => `${c.label} vai até ${s.time.split(/[–—-]/)[1].trim()} (${shiftDuration(s.time)})`),
      cells: WEEKDAY_COLS.map(c => {
        const shift = blocosAtivos(WEEKDAY_SHIFTS, c.dow, hojeStr)[i];
        const override = WEEKDAY_DISPLAY_OVERRIDES[c.dow]?.[i];
        return override ? { ...shift, person: override } : shift;
      }),
    }));
  }, [hojeStr]);

  // Fim de semana: escada de 6 semanas gerada do roster (vigente a partir de WEEKEND_CHANGE).
  const weekendRows = useMemo(() => {
    return Array.from({ length: WEEKEND_ROSTER.length }, (_, w) => {
      const sat = new Date(WEEKEND_CHANGE.getTime() + w * 7 * MS_DAY);
      return weekendAssignment(sat);
    });
  }, []);

  // Blocos por dia-da-semana + faixas sem cobertura, para equipes sem rotação
  // (infra e desenvolvimento) — os blocos nascem vagos, não há ninguém pra mostrar.
  const genericWeek = useMemo(() => {
    if (!team || team.rotacao) return null;
    return FULL_WEEK.map(c => {
      const shifts = blocosAtivos(team.blocos, c.dow, hojeStr) || [];
      return { ...c, shifts, gaps: coverageGaps(shifts) };
    });
  }, [team, hojeStr]);

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
          <div className="text-2xl font-bold">{team ? team.nome : 'Semana e fim de semana'}</div>
          <div className="text-sm opacity-80 mt-1">Visão da estrutura vigente do rodízio · somente leitura</div>
        </header>

        {/* SELETOR DE EQUIPE — só as que a pessoa administra */}
        {allowed.length > 1 && (
          <section className="mb-5" aria-label="Seletor de equipe">
            <div className="flex flex-wrap gap-2">
              {allowed.map(id => (
                <button key={id} onClick={() => setSelectedTeamId(id)} aria-pressed={teamId === id}
                  className="px-3.5 rounded-full text-sm font-bold transition-all"
                  style={{ minHeight: '2.5rem', background: teamId === id ? T.filterAllBg : T.filterDefBg, color: teamId === id ? T.filterAllColor : T.filterDefColor, border: `1.5px solid ${teamId === id ? T.filterAllBorder : T.filterDefBorder}` }}>
                  {TEAMS[id].nome}
                </button>
              ))}
            </div>
          </section>
        )}

        <p className="flex items-start gap-1.5 text-xs mb-5" style={{ color: T.textMuted }}>
          <Icon name="alert" size={13} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
          <span>Esta tela mostra a <b style={{ color: T.textSecondary }}>estrutura base</b> do rodízio. Trocas eventuais, feriados e ajustes de um dia específico continuam na aba <b style={{ color: T.textSecondary }}>Escala</b>. A edição da estrutura aqui chega numa próxima etapa.</span>
        </p>

        {!team ? (
          <div className="rounded-xl p-6 text-center text-sm" style={{ background: T.cardBg, border: `1px solid ${T.cardBorder}`, color: T.textMuted }}>
            Nenhuma equipe disponível.
          </div>
        ) : teamId === 'sustentacao' ? (
          <>
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
                            <div className="font-mono text-xs" style={{ color: T.textMuted }}>{row.time} · {row.dur}{row.excecoes.length ? ' *' : ''}</div>
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
              {weekdayRows.some(r => r.excecoes.length) && (
                <p className="text-xs mt-2" style={{ color: T.textMuted }}>
                  * {weekdayRows.flatMap(r => r.excecoes).join('; ')}.
                </p>
              )}
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
                        <th style={th} scope="col">Sáb Dia<br /><span className="font-mono" style={{ fontWeight: 400 }}>23:00–11:00</span></th>
                        <th style={th} scope="col">Sáb Noite<br /><span className="font-mono" style={{ fontWeight: 400 }}>11:00–23:00</span></th>
                        <th style={th} scope="col">Dom Dia<br /><span className="font-mono" style={{ fontWeight: 400 }}>23:00–11:00</span></th>
                        <th style={th} scope="col">Dom Noite<br /><span className="font-mono" style={{ fontWeight: 400 }}>11:00–23:00</span></th>
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
          </>
        ) : (
          // Infra e desenvolvimento: sem rotação — blocos por dia-da-semana, faixas
          // sem cobertura e aviso de atribuição manual (docs/specs/multi-equipe.md §5).
          <section>
            <p className="flex items-start gap-1.5 text-xs mb-4" style={{ color: '#F59E0B' }}>
              <Icon name="alert" size={13} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
              <span><b>Sem rodízio definido — atribuição manual pelo admin.</b> Os blocos abaixo existem (têm horário e duração), mas ninguém é atribuído automaticamente; a atribuição é feita turno a turno na aba Escala.</span>
            </p>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
              {genericWeek.map(c => (
                <div key={c.dow} style={cardStyle} className="p-3">
                  <div className="font-semibold text-sm mb-1.5" style={{ color: T.textPrimary }}>{c.label}</div>
                  {c.shifts.length === 0 ? (
                    <div className="text-xs" style={{ color: T.textMuted }}>Sem turnos</div>
                  ) : (
                    <div className="space-y-1 mb-2">
                      {c.shifts.map((s, i) => (
                        <div key={i} className="text-xs">
                          <span className="font-semibold" style={{ color: T.textSecondary }}>{s.period}</span>{' '}
                          <span className="font-mono" style={{ color: T.textMuted }}>{s.time} · {shiftDuration(s.time)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {c.gaps.length > 0 && (
                    <div className="text-[10px] mt-1.5 pt-1.5" style={{ borderTop: `1px dashed ${T.cardBorder}`, color: T.textMuted }}>
                      Sem cobertura: {c.gaps.join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {team.startsOn && (
              <p className="text-xs mt-3" style={{ color: T.textMuted }}>Equipe existe a partir de {String(team.startsOn).slice(8, 10)}/{String(team.startsOn).slice(5, 7)}/{String(team.startsOn).slice(0, 4)}.</p>
            )}
          </section>
        )}

      </div>
    </div>
  );
}
