import { useMemo, useState } from 'react';
import {
  WEEKDAY_SHIFTS, WEEKEND_ROSTER, WEEKEND_CHANGE, MS_DAY,
  weekendAssignment, shiftPeople, blocosAtivos, dayKey, parseTimeRange, shiftDuration,
} from '../lib/schedule';
import { TEAMS } from '../lib/teams';
import { getTheme, memberTone } from '../lib/theme';
import { Icon, Panel, Segmented, SegmentedItem } from './ui';

// Chip de pessoa numa célula da tabela — mesmo desenho do PersonTag da aba Escala
// (rChip, tinta/tint da própria pessoa, ponto de 6px). A cor vem de
// memberTone(name, dark), não mais do par { color, bg } de PEOPLE: aqueles valores
// eram Material 2014 desenhados para fundo claro e falhavam contraste no tema
// escuro. memberTone fixa a lightness por tema, então as 19 pessoas têm o mesmo
// contraste contra a mesma superfície.
function Pessoa({ name, T, dark }) {
  const tone = memberTone(name, dark);
  return (
    <span
      className="inline-flex items-center gap-1.5"
      style={{
        color: tone.ink, background: tone.tint, fontWeight: 600, fontSize: '0.8rem',
        borderRadius: T.rChip, padding: '0.1rem 0.4rem',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: tone.dot, flexShrink: 0 }} />
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

// Horários das estações do fim de semana, no cabeçalho da tabela da escada.
const WEEKEND_COLS = [
  { key: 'sabDia',   label: 'Sáb Dia',   time: '23:00–11:00' },
  { key: 'sabNoite', label: 'Sáb Noite', time: '11:00–23:00' },
  { key: 'domDia',   label: 'Dom Dia',   time: '23:00–11:00' },
  { key: 'domNoite', label: 'Dom Noite', time: '11:00–23:00' },
];

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

  // ─── Estilos de tabela ─────────────────────────────────────────────────────
  // Esta tela é referência somente-leitura: tabelas de verdade, com hairline de 1px
  // separando linhas, altura de linha contida, cabeçalho calmo em caixa alta e
  // numeral tabular + mono em todo horário e duração (índices e horas alinham
  // coluna a coluna). Nada de cards flutuantes nem sombra — painel tem borda.
  const th = {
    textAlign: 'left', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.06em',
    textTransform: 'uppercase', color: T.textMuted, padding: '0.5rem 0.7rem',
    whiteSpace: 'nowrap', background: T.surfaceAlt, borderBottom: `1px solid ${T.border}`,
  };
  const thNum = { ...th, textAlign: 'right' };
  const td = { padding: '0.4rem 0.7rem', whiteSpace: 'nowrap', fontSize: '0.82rem', verticalAlign: 'middle' };
  const tdMono = { ...td, fontFamily: T.fontMono, fontSize: '0.76rem', color: T.textMuted };
  const tdNum = { ...tdMono, textAlign: 'right' };
  const rowLabel = { ...td, textAlign: 'left', fontWeight: 600, color: T.textPrimary };
  const tableStyle = { width: '100%', borderCollapse: 'collapse' };
  const sectionH2 = {
    fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
    color: T.textMuted, margin: '0 0 0.4rem',
  };
  const noteStyle = { fontSize: '0.75rem', color: T.textMuted, margin: '0.5rem 0 0', lineHeight: 1.55 };
  const hair = `1px solid ${T.border}`;

  const changeStr = `${String(WEEKEND_CHANGE.getDate()).padStart(2, '0')}/${String(WEEKEND_CHANGE.getMonth() + 1).padStart(2, '0')}/${WEEKEND_CHANGE.getFullYear()}`;

  return (
    <div style={{ minHeight: '100vh', background: T.pageBg, fontFamily: T.fontSans, color: T.textPrimary, transition: 'background 0.2s,color 0.2s' }}>
      <div className="mx-auto px-3 sm:px-4 py-4" style={{ maxWidth: '1100px' }}>

        {/* BARRA DE FERRAMENTAS — seletor de equipe (só as que a pessoa administra).
            Era uma fileira de pílulas; agora é o controle segmentado do sistema. */}
        {allowed.length > 1 && (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Segmented T={T} role="group" aria-label="Equipe">
              {allowed.map((id, i) => (
                <SegmentedItem key={id} T={T} first={i === 0}
                  active={teamId === id} onClick={() => setSelectedTeamId(id)}>
                  {TEAMS[id].nome}
                </SegmentedItem>
              ))}
            </Segmented>
          </div>
        )}

        {/* TÍTULO — sem bloco colorido e sem eyebrow: o nome da equipe é o título,
            e a natureza da tela vem na linha secundária (e na aba, em App.jsx). */}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
          <h1 style={{ fontSize: '1.15rem', fontWeight: 700, letterSpacing: '-0.01em', color: T.textPrimary, margin: 0 }}>
            {team ? team.nome : 'Semana e fim de semana'}
          </h1>
          <span style={{ fontSize: '0.78rem', color: T.textMuted }}>
            Visão da estrutura vigente do rodízio · somente leitura
          </span>
        </div>

        <p className="flex items-start gap-1.5" style={{ fontSize: '0.76rem', color: T.textMuted, lineHeight: 1.55, margin: '0 0 1rem' }}>
          <Icon name="alert" size={13} style={{ flexShrink: 0, marginTop: '0.2rem' }} />
          <span>Esta tela mostra a <b style={{ color: T.textSecondary }}>estrutura base</b> do rodízio. Trocas eventuais, feriados e ajustes de um dia específico continuam na aba <b style={{ color: T.textSecondary }}>Escala</b>. A edição da estrutura aqui chega numa próxima etapa.</span>
        </p>

        {!team ? (
          <Panel T={T} style={{ padding: '2rem 1rem', textAlign: 'center' }}>
            <p style={{ fontSize: '0.85rem', color: T.textMuted, margin: 0 }}>Nenhuma equipe disponível.</p>
          </Panel>
        ) : teamId === 'sustentacao' ? (
          <>
            {/* SEMANA */}
            <section className="mb-5">
              <h2 style={sectionH2}>Semana (seg – sex)</h2>
              <Panel T={T} style={{ overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ ...tableStyle, minWidth: '720px' }}>
                    <thead>
                      <tr>
                        <th style={th} scope="col">Turno</th>
                        <th style={th} scope="col">Horário</th>
                        <th style={thNum} scope="col">Duração</th>
                        {WEEKDAY_COLS.map(c => <th key={c.dow} style={th} scope="col">{c.label}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {weekdayRows.map((row, i) => {
                        const top = i > 0 ? hair : 'none';
                        return (
                          <tr key={i}>
                            <th scope="row" style={{ ...rowLabel, borderTop: top }}>{row.period}</th>
                            <td className="tnum" style={{ ...tdMono, borderTop: top }}>{row.time}</td>
                            <td className="tnum" style={{ ...tdNum, borderTop: top, borderRight: hair }}>
                              {row.dur}{row.excecoes.length ? ' *' : ''}
                            </td>
                            {row.cells.map((shift, ci) => (
                              <td key={ci} style={{ ...td, borderTop: top }}>
                                <span className="inline-flex flex-wrap items-center gap-1">
                                  {shiftPeople(shift).map((n, k) => <Pessoa key={k} name={n} T={T} dark={dark} />)}
                                </span>
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>
              {weekdayRows.some(r => r.excecoes.length) && (
                <p style={noteStyle}>* {weekdayRows.flatMap(r => r.excecoes).join('; ')}.</p>
              )}
            </section>

            {/* FIM DE SEMANA */}
            <section>
              <h2 style={sectionH2}>Fim de semana — escada de 6 semanas</h2>
              <Panel T={T} style={{ overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ ...tableStyle, minWidth: '680px' }}>
                    <thead>
                      <tr>
                        <th style={thNum} scope="col">Semana</th>
                        {WEEKEND_COLS.map(c => (
                          <th key={c.key} style={th} scope="col">
                            {c.label}<br />
                            <span className="tnum" style={{ fontFamily: T.fontMono, fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>
                              {c.time}
                            </span>
                          </th>
                        ))}
                        <th style={th} scope="col">Folga</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weekendRows.map((r, i) => {
                        const top = i > 0 ? hair : 'none';
                        return (
                          <tr key={i}>
                            <th scope="row" className="tnum"
                              style={{ ...tdNum, borderTop: top, borderRight: hair, fontWeight: 700, color: T.textSecondary }}>
                              {i + 1}
                            </th>
                            {WEEKEND_COLS.map(c => (
                              <td key={c.key} style={{ ...td, borderTop: top }}>
                                <Pessoa name={r[c.key]} T={T} dark={dark} />
                              </td>
                            ))}
                            <td style={{ ...td, borderTop: top, borderLeft: hair }}>
                              <span className="inline-flex flex-wrap items-center gap-1">
                                {r.folga.map((n, k) => <Pessoa key={k} name={n} T={T} dark={dark} />)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>
              <p style={noteStyle}>
                Cada pessoa avança uma coluna por semana (Sáb Dia → Sáb Noite → Dom Dia → Dom Noite → Folga → Folga). Vigente a partir de <span className="tnum">{changeStr}</span>.
              </p>
            </section>
          </>
        ) : (
          // Infra e desenvolvimento: sem rotação — blocos por dia-da-semana, faixas
          // sem cobertura e aviso de atribuição manual (docs/specs/multi-equipe.md §5).
          <section>
            {/* Informativo, não erro: a faixa é warn-quiet com hairline, não texto
                âmbar solto num hex de tema claro (era '#F59E0B' fixo). */}
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', background: T.warnQuiet, border: `1px solid ${T.warnBorder}`, borderRadius: T.rControl, padding: '0.55rem 0.7rem', margin: '0 0 0.9rem' }}>
              <Icon name="alert" size={14} style={{ color: T.warn, flexShrink: 0, marginTop: '0.15rem' }} />
              <div style={{ fontSize: '0.76rem', color: T.textSecondary, lineHeight: 1.55 }}>
                <b style={{ color: T.warn }}>Sem rodízio definido — atribuição manual pelo admin.</b> Os blocos abaixo existem (têm horário e duração), mas ninguém é atribuído automaticamente; a atribuição é feita turno a turno na aba Escala.
              </div>
            </div>

            <Panel T={T} style={{ overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ ...tableStyle, minWidth: '620px' }}>
                  <thead>
                    <tr>
                      <th style={th} scope="col">Dia</th>
                      <th style={th} scope="col">Turno</th>
                      <th style={th} scope="col">Horário</th>
                      <th style={thNum} scope="col">Duração</th>
                      <th style={th} scope="col">Sem cobertura</th>
                    </tr>
                  </thead>
                  <tbody>
                    {genericWeek.map((c, ci) => {
                      // Uma linha por bloco; o dia e as faixas sem cobertura valem para
                      // o grupo inteiro (rowSpan). Dia sem bloco vira uma linha só.
                      const rows = c.shifts.length ? c.shifts : [null];
                      const groupTop = ci > 0 ? hair : 'none';
                      return rows.map((s, si) => (
                        <tr key={`${c.dow}-${si}`}>
                          {si === 0 && (
                            <th scope="row" rowSpan={rows.length}
                              style={{ ...rowLabel, borderTop: groupTop, borderRight: hair, verticalAlign: 'top' }}>
                              {c.label}
                            </th>
                          )}
                          {s ? (
                            <>
                              <td style={{ ...td, borderTop: si === 0 ? groupTop : hair, fontWeight: 600, color: T.textSecondary }}>
                                {s.period}
                              </td>
                              <td className="tnum" style={{ ...tdMono, borderTop: si === 0 ? groupTop : hair }}>{s.time}</td>
                              <td className="tnum" style={{ ...tdNum, borderTop: si === 0 ? groupTop : hair, borderRight: hair }}>
                                {shiftDuration(s.time)}
                              </td>
                            </>
                          ) : (
                            <td colSpan={3} style={{ ...td, borderTop: groupTop, borderRight: hair, color: T.textMuted, fontStyle: 'italic' }}>
                              Sem turnos
                            </td>
                          )}
                          {si === 0 && (
                            <td rowSpan={rows.length} className="tnum"
                              style={{ ...tdMono, borderTop: groupTop, verticalAlign: 'top' }}>
                              {c.gaps.length ? c.gaps.join(', ') : '—'}
                            </td>
                          )}
                        </tr>
                      ));
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
            {team.startsOn && (
              <p style={noteStyle}>
                Equipe existe a partir de <span className="tnum">{String(team.startsOn).slice(8, 10)}/{String(team.startsOn).slice(5, 7)}/{String(team.startsOn).slice(0, 4)}</span>.
              </p>
            )}
          </section>
        )}

      </div>
    </div>
  );
}
