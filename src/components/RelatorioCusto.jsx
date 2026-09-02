import { useState, useEffect, useMemo, useRef } from 'react';
import { useApi } from '../lib/api';
import {
  loadCustoSources, custoConsolidado, buildCustoCsv, currentMonthKey, monthKeysForRange,
} from '../lib/custoConsolidado';
import { TEAMS, MEMBERS, chGroupsFor } from '../lib/teams';
import { MONTHS_SHORT, fmtHM, brl } from '../lib/schedule';
import { getTheme, memberTone } from '../lib/theme';
import {
  Icon, Button, Badge, Panel, SectionLabel, Segmented, SegmentedItem, friendlyError,
} from './ui';

// Visão de custo do Relatório Consolidado (docs/specs/relatorio-consolidado-custo.md).
//
// A camada financeira é inteiramente do módulo puro `src/lib/custoConsolidado.js`
// (Ledger) — este componente NÃO calcula nada: recebe `sources` da carga, chama
// `custoConsolidado(params)` com os filtros, e desenha o que ele devolve. Regra do
// ticket: nenhuma fórmula financeira aqui.
//
// Registro (PRODUCT.md — console Grafana/Datadog): densidade alta, hairline de 1px
// como estrutura, acento só em interação, semântico só em estado, matiz só em
// pessoa/equipe, numeral tabular em todo valor, contraste AA. Tudo via tokens de
// `getTheme` — nenhum hex de estado escrito à mão.

// ─── Cores de categoria (componentes financeiros e equipes) ─────────────────
// Derivadas em OKLCH com lightness e chroma FIXOS por tema, no mesmo princípio de
// memberTone(): contraste uniforme e matiz distinguível sem hex chumbado no
// componente. Componentes financeiros acompanham a linguagem do Controle de Horas
// (SA=info, HE=success, Comp=warn); remuneração ganha um azul próprio.
const COMPONENT_HUES = { remuneracao: 250, sobreaviso: 200, horaExtra: 142, compensacao: 70 };
const TEAM_HUES = { sustentacao: 220, desenvolvimento: 128, infra: 48 };

export function componentTone(kind, dark) {
  const hue = COMPONENT_HUES[kind] ?? 250;
  const l = dark ? 0.74 : 0.45;
  const c = dark ? 0.10 : 0.12;
  return { hue, fill: `oklch(${l} ${c} ${hue})`, hueText: `oklch(${dark ? 0.82 : 0.42} ${c} ${hue})` };
}
export function teamTone(teamId, dark) {
  const hue = TEAM_HUES[teamId] ?? 250;
  const l = dark ? 0.74 : 0.45;
  const c = dark ? 0.11 : 0.13;
  return { hue, fill: `oklch(${l} ${c} ${hue})`, hueText: `oklch(${dark ? 0.83 : 0.40} ${c} ${hue})` };
}

export const COMPONENT_LABELS = {
  remuneracao: 'Remuneração', sobreaviso: 'Sobreaviso', horaExtra: 'Hora Extra', compensacao: 'Compensação',
};

export const ESTADO_META = {
  fechado: { label: 'Fechado', tone: 'success', icon: 'check', desc: 'Sob snapshot imutável' },
  aberto: { label: 'Em aberto', tone: 'info', icon: 'clock', desc: 'Recalculado do mês atual' },
  estimado: { label: 'Estimado', tone: 'warn', icon: 'umbrella', desc: 'Remuneração atual aplicada a período histórico' },
  'sem-dados': { label: 'Sem dados', tone: 'neutral', icon: 'x', desc: 'Sem atividade no período' },
};

export const METRIC_META = {
  custo: { label: 'Custo Mensal', short: 'Custo', fmt: (v) => (v == null ? '—' : brl(v)), unit: 'R$' },
  horasSA: { label: 'Horas de Sobreaviso', short: 'Sobreaviso', fmt: (v) => (v == null ? '—' : fmtHM(v)), unit: 'h' },
  horasHE: { label: 'Horas Extras', short: 'Hora Extra', fmt: (v) => (v == null ? '—' : fmtHM(v)), unit: 'h' },
};

// arredonda a escala do eixo para um número "limpo" (1 / 1.5 / 2 / 2.5 / 5 × 10^n)
function niceCeil(v) {
  if (!v || v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const frac = v / base;
  const nice = frac <= 1 ? 1 : frac <= 1.5 ? 1.5 : frac <= 2 ? 2 : frac <= 2.5 ? 2.5 : frac <= 5 ? 5 : 10;
  return nice * base;
}

const MONTH_LABEL = (monthKey) => {
  const [y, m] = String(monthKey).split('-');
  const idx = Number(m) - 1;
  return `${MONTHS_SHORT[idx] ?? ''} ${String(y).slice(2)}`;
};

// ─── GRÁFICO ─────────────────────────────────────────────────────────────────
// SVG denso, sem biblioteca (o app não carrega lib de chart). Dois modos:
//   stacked — uma equipe / métrica custo: coluna empilhada por componente, com
//             Compensação como abatimento (segmento abaixo da linha zero).
//   grouped — várias equipes (ou métricas de hora): uma série por equipe.
// A seleção (mês/equipe) é feita por botões transparentes sobre as colunas — nunca
// só por hover; a tabela abaixo é a alternativa acessível sincronizada.
export function CustoChart({ dadosChart, mode, metric, situacao, selectedMonth, selectedTeamId, dark, T, onSelectMonth, onSelectTeam }) {
  const H = 240;
  const padL = 46, padR = 16, padT = 14, padB = 8;
  const plotW = 900 - padL - padR;
  const plotH = H - padT - padB;
  const baseline = padT + plotH;
  const n = dadosChart.length;
  const groupW = n ? plotW / n : plotW;
  const wrapRef = useRef(null);

  // escala
  const maxVal = useMemo(() => {
    if (!dadosChart.length) return 1;
    let m = 0;
    for (const c of dadosChart) {
      for (const tm of c.teams) {
        if (mode === 'stacked') {
          const pos = (tm.stacked || []).filter(s => s.value != null && s.value > 0).reduce((a, s) => a + s.value, 0);
          m = Math.max(m, pos);
        } else {
          m = Math.max(m, tm.value ?? 0);
        }
      }
    }
    return niceCeil(m);
  }, [dadosChart, mode]);
  const y = (v) => baseline - (v / maxVal) * plotH;
  const fmtAxis = metric === 'custo' ? (v) => (v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v))) : (v) => fmtHM(v);

  const ticks = useMemo(() => {
    const t = [];
    for (let i = 0; i <= 4; i++) t.push((maxVal / 4) * i);
    return t;
  }, [maxVal]);

  const stateColors = { fechado: T.success, aberto: T.info, estimado: T.warn, 'sem-dados': T.textMuted };
  const barW = mode === 'stacked' ? Math.min(52, groupW * 0.56) : Math.min(40, (groupW * 0.72) / Math.max(1, dadosChart[0]?.teams.length || 1));

  // clique no gráfico: seleciona mês (sempre) e, no modo agrupado, a equipe da barra
  const handleChartClick = (e) => {
    if (!wrapRef.current || !dadosChart.length) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const colW = rect.width / dadosChart.length;
    const colIdx = Math.max(0, Math.min(dadosChart.length - 1, Math.floor(x / colW)));
    const c = dadosChart[colIdx];
    if (!c) return;
    onSelectMonth(c.monthKey);
    if (mode === 'grouped' && c.teams.length > 0) {
      const inner = x - colIdx * colW;
      const teamW = colW / c.teams.length;
      const teamIdx = Math.max(0, Math.min(c.teams.length - 1, Math.floor(inner / teamW)));
      const tm = c.teams[teamIdx];
      if (tm) onSelectTeam(tm.teamId);
    }
  };

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <div ref={wrapRef} onClick={handleChartClick} style={{ position: 'relative', cursor: 'pointer', minWidth: '640px' }} aria-label="Clique em uma coluna para selecionar o mês e a equipe">
        <svg
          role="img"
          aria-label={`Gráfico de ${METRIC_META[metric].label}, ${mode === 'stacked' ? 'empilhado por componente financeiro' : 'uma série por equipe'}. Período de ${dadosChart[0]?.monthKey ?? ''} a ${dadosChart[dadosChart.length - 1]?.monthKey ?? ''}.`}
          viewBox={`0 0 900 ${H}`}
          style={{ width: '100%', minWidth: '640px', height: 'auto', fontFamily: T.fontMono, display: 'block', color: T.textMuted }}
        >
          {/* linhas de grade e eixo do valor */}
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={padL} x2={900 - padR} y1={y(t)} y2={y(t)} stroke={T.border} strokeWidth="1" />
              <text x={padL - 6} y={y(t) + 3} textAnchor="end" style={{ fontSize: '9px', fill: T.textMuted, dominantBaseline: 'middle' }}>{fmtAxis(t)}</text>
            </g>
          ))}

          {dadosChart.map((c, i) => {
            const cx = padL + groupW * i + groupW / 2;
            const wx = cx - barW / 2;
            const isSel = c.monthKey === selectedMonth;

            return (
              <g key={c.monthKey}>
                {/* colunas agrupadas por equipe */}
                {mode !== 'stacked' && c.teams.map((tm, ti) => {
                  const tx = cx - ((c.teams.length * barW) / 2) + ti * barW;
                  const v = tm.value ?? 0;
                  const h = (v / maxVal) * plotH;
                  const hue = teamTone(tm.teamId, dark);
                  const sel = isSel && selectedTeamId === tm.teamId;
                  return (
                    <g key={tm.teamId}>
                      <rect x={tx} y={y(v)} width={barW} height={h} rx={1.5}
                        fill={hue.fill} opacity={isSel && !sel ? 0.45 : 1}
                        stroke={sel ? T.textPrimary : 'none'} strokeWidth={sel ? 1 : 0} />
                      <title>{(() => {
                        const compo = metric === 'custo' && tm.stacked
                          ? ['remuneracao', 'sobreaviso', 'horaExtra', 'compensacao'].map(k => {
                              const s = tm.stacked.find(x => x.kind === k);
                              const val = s?.value;
                              return `${COMPONENT_LABELS[k]}: ${val == null ? '—' : (k === 'compensacao' && val > 0 ? `− ${brl(val)}` : brl(val))}`;
                            }).join('  ·  ')
                          : '';
                        return `${tm.teamNome} · ${c.monthKey}: ${METRIC_META[metric].fmt(v)}${compo ? `\n${compo}` : ''}`;
                      })()}</title>
                      {sel && (
                        <text className="rc-chart-value" x={tx + barW / 2} y={Math.max(padT + 8, y(v) - 5)} textAnchor="middle"
                          style={{ fontSize: '9px', fontWeight: 700, fill: T.textPrimary, paintOrder: 'stroke', stroke: T.surface, strokeWidth: 3 }}>
                          {METRIC_META[metric].fmt(v)}
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* coluna empilhada por componente (uma equipe / métrica custo) */}
                {mode === 'stacked' && c.teams[0] && (() => {
                  const tm = c.teams[0];
                  const pos = (tm.stacked || []).filter(s => s.value != null && s.value > 0 && s.kind !== 'compensacao');
                  const comp = (tm.stacked || []).find(s => s.kind === 'compensacao');
                  // Rótulo do total líquido: centralizado na coluna (não invade barra
                  // vizinha) e com halo na cor do painel, para nunca ficar atrás da barra.
                  const netY = y(tm.value ?? 0);
                  const labelY = Math.max(padT + 8, Math.min(netY - 5, baseline - 5));
                  let cursor = baseline;
                  return (
                    <g>
                      {pos.map((s) => {
                        const hSeg = (s.value / maxVal) * plotH;
                        const tone = componentTone(s.kind, dark);
                        const el = (
                          <rect key={s.kind + tm.teamId} x={wx} y={cursor - hSeg} width={barW} height={hSeg} rx={1}
                            fill={tone.fill} stroke="none">
                            <title>{`${COMPONENT_LABELS[s.kind]} · ${c.monthKey}: ${brl(s.value)}`}</title>
                          </rect>
                        );
                        cursor -= hSeg;
                        return el;
                      })}
                      {comp && comp.value != null && comp.value > 0 && (
                        <rect x={wx} y={baseline} width={barW} height={(comp.value / maxVal) * plotH} rx={1}
                          fill={componentTone('compensacao', dark).fill} opacity={0.9}>
                          <title>{`Compensação (abate) · ${c.monthKey}: − ${brl(comp.value)}`}</title>
                        </rect>
                      )}
                      {/* marca do total líquido + rótulo */}
                      <line x1={wx} x2={wx + barW} y1={netY} y2={netY} stroke={T.textPrimary} strokeWidth={1} />
                      <text className="rc-chart-value" x={wx + barW / 2} y={labelY} textAnchor="middle"
                        style={{ fontSize: '9px', fontWeight: 700, fill: T.textPrimary, paintOrder: 'stroke', stroke: T.surface, strokeWidth: 3 }}>
                        {METRIC_META[metric].fmt(tm.value)}
                      </text>
                    </g>
                  );
                })()}

                {/* rastro de base */}
                <line x1={cx - groupW / 2 + 2} x2={cx + groupW / 2 - 2} y1={baseline} y2={baseline} stroke={T.borderStrong} strokeWidth="1" />
              </g>
            );
          })}
        </svg>
      </div>

      {/* eixo de meses — botões acessíveis, mesma largura das colunas; servem de
          rótulo E de destino de seleção por teclado */}
      <div style={{ display: 'flex', gap: '2px', marginTop: '0.2rem', minWidth: '640px', paddingLeft: '5.11%', paddingRight: '1.78%' }}>
        {dadosChart.map((c) => {
          const isSel = c.monthKey === selectedMonth;
          return (
            <button
              key={c.monthKey}
              type="button"
              aria-pressed={isSel}
              aria-label={`Selecionar o mês ${c.monthKey}`}
              onClick={() => onSelectMonth(c.monthKey)}
              style={{
                flex: '1 1 0', minWidth: 0, background: isSel ? T.accentFill : 'transparent',
                color: isSel ? T.accentInk : T.textSecondary, border: '1px solid transparent', borderTop: `1px solid ${isSel ? T.accentFill : T.border}`,
                borderRadius: '0 0 ' + T.rControl + ' ' + T.rControl, padding: '0.35rem 0.1rem', minHeight: '2.75rem', fontSize: '0.62rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              <span className="inline-flex items-center gap-1">
                <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: '50%', background: stateColors[c.estado] || T.textMuted }} />
                {MONTH_LABEL(c.monthKey)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── INDICADORES ─────────────────────────────────────────────────────────────
export function IndicatorTile({ label, value, sub, tone, T }) {
  const c = tone ? { accent: T.accent, success: T.success, warn: T.warn, danger: T.danger, info: T.info, neutral: T.textMuted }[tone] || T.textMuted : T.textPrimary;
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.rControl, padding: '0.7rem 0.8rem', minHeight: '4.75rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
      <div style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: T.textMuted }}>{label}</div>
      <div className="tnum" style={{ fontSize: '1.3rem', fontWeight: 700, lineHeight: 1.2, color: T.textPrimary, letterSpacing: '-0.01em' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.7rem', color: T.textSecondary }}>{sub}</div>}
    </div>
  );
}

// ─── DETALHAMENTO ────────────────────────────────────────────────────────────
export function DetailTable({ comp, metric, includeRemuneracao, situacao, dark, T, selectedTeamId }) {
  if (!comp) return null;
  const th = { textAlign: 'right', fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: T.textMuted, padding: '0.5rem 0.6rem', whiteSpace: 'nowrap', borderBottom: `1px solid ${T.border}` };
  const thL = { ...th, textAlign: 'left' };
  const td = { textAlign: 'right', padding: '0.4rem 0.6rem', whiteSpace: 'nowrap', fontFamily: T.fontMono, fontSize: '0.8rem', color: T.textSecondary };
  const tdName = { padding: '0.4rem 0.6rem', color: T.textPrimary, fontWeight: 600, whiteSpace: 'nowrap' };
  // Visão de situação (Ledger): Pendente/Rejeitado passam a detalhar os valores
  // POTENCIAIS (horas + valor) do conjunto da situação, nunca os realizados.
  const situ = metric === 'horasSA' ? 'realizado' : situacao;
  const isSituacional = situ === 'pendente' || situ === 'rejeitado';
  const SITU_HOURS_LABEL = situ === 'pendente' ? 'HE Pendente' : 'HE Rejeitada';
  const monthSitu = comp.total.situacoes?.[situ] || {};
  const identCols = 2;
  const estadoCols = isSituacional ? 2 : 3;
  const bodyCols = isSituacional ? 2 : (metric === 'custo' ? (includeRemuneracao ? 7 : 6) : 2);
  const totalCols = identCols + bodyCols + estadoCols;

  const teams = comp.equipes.filter(e => !selectedTeamId || e.teamId === selectedTeamId);
  const renderRows = (tm) => tm.pessoas.map((p) => {
    const nome = MEMBERS[p.person]?.fullName || p.person;
    const tone = memberTone(p.person, dark);
    const estado = ESTADO_META[p.estado] || ESTADO_META['sem-dados'];
    // Bloco uniforme de situação (Ledger): horas/valor/custo do MESMO conjunto por
    // situação — nunca misturado com o realizado.
    const sP = p.situacoes || {};
    const situBloco = sP[situ] || {};
    const hePend = sP.pendente?.horasHE ?? p.hePendenteHoras ?? 0;
    const heRej = sP.rejeitado?.horasHE ?? p.heRejeitadoHoras ?? 0;
    const heAprov = (sP.realizado?.horasHE ?? p.horasHE ?? 0) > 0;
    return (
      <tr key={p.person} style={{ borderTop: `1px solid ${T.border}` }}>
        <td style={tdName}>
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: tone.dot }} />
            {nome}
          </span>
        </td>
        <td style={tdName}>{TM_NOME(p.teamId)}</td>
        {!isSituacional ? (
          metric === 'custo' ? (
            <>
              {includeRemuneracao && <td className="tnum" style={td}>{p.remuneracao == null ? '—' : brl(p.remuneracao)}</td>}
              <td className="tnum" style={td}>{p.valorSA == null ? '—' : brl(p.valorSA)}</td>
              <td className="tnum" style={td}>{p.valorHE == null ? '—' : brl(p.valorHE)}</td>
              <td className="tnum" style={{ ...td, color: p.valorComp == null ? T.textMuted : (p.valorComp > 0 ? T.danger : T.textMuted) }}>{p.valorComp == null ? '—' : (p.valorComp > 0 ? `− ${brl(p.valorComp)}` : brl(0))}</td>
              <td className="tnum" style={{ ...td, fontWeight: 700, color: T.textPrimary }}>{p.custo == null ? '—' : brl(p.custo)}</td>
              <td className="tnum" style={td}>{p.horasSA == null ? '—' : fmtHM(p.horasSA)}</td>
              <td className="tnum" style={td}>{p.horasHE == null ? '—' : fmtHM(p.horasHE)}</td>
            </>
          ) : (
            <>
              <td className="tnum" style={td}>{p.horasSA == null ? '—' : fmtHM(p.horasSA)}</td>
              <td className="tnum" style={td}>{p.horasHE == null ? '—' : fmtHM(p.horasHE)}</td>
            </>
          )
        ) : (
          <>
            <td className="tnum" style={{ ...td, fontWeight: 700, color: T.textPrimary }}>{situBloco.valorHE == null ? '—' : brl(situBloco.valorHE)}</td>
            <td className="tnum" style={{ ...td, color: situ === 'rejeitado' ? T.danger : T.warn }}>{situBloco.horasHE == null ? '—' : fmtHM(situBloco.horasHE)}</td>
          </>
        )}
        {!isSituacional && (
          <td style={tdName}>
            {p.estado === 'sem-dados' ? (
              <Badge T={T} tone="neutral">sem dados</Badge>
            ) : hePend > 0 || heRej > 0 ? (
              <Badge T={T} tone={heRej > 0 ? 'danger' : 'warn'}>
                {heRej > 0 ? `rejeitada ${fmtHM(heRej)}` : `pendente ${fmtHM(hePend)}`}
              </Badge>
            ) : heAprov ? (
              <Badge T={T} tone="success">aprovada</Badge>
            ) : (
              <Badge T={T} tone="neutral">sem HE</Badge>
            )}
          </td>
        )}
        <td style={tdName}>
          <Badge T={T} tone={estado.tone} icon={estado.icon}>{estado.label}</Badge>
        </td>
        <td style={{ ...td, color: T.textMuted }}>{p.origem === 'snapshot' ? 'snapshot' : p.origem === 'recalculado' ? 'recalculado' : '—'}</td>
      </tr>
    );
  });

  return (
    <div className="rc-detail-scroll" style={{ overflowX: 'auto' }}>
      <table className="w-full rc-detail-table" style={{ borderCollapse: 'collapse', minWidth: isSituacional ? '480px' : (metric === 'custo' ? '760px' : '620px'), fontSize: '0.82rem' }}>
        <thead>
          <tr>
            <th style={thL} scope="col">Pessoa</th>
            <th style={thL} scope="col">Equipe</th>
            {!isSituacional ? (
              metric === 'custo' ? (
                <>
                  {includeRemuneracao && <th style={th} scope="col">Remuneração</th>}
                  <th style={th} scope="col">Sobreaviso</th>
                  <th style={th} scope="col">Hora Extra</th>
                  <th style={th} scope="col">Compensação</th>
                  <th style={th} scope="col">Custo</th>
                  <th style={th} scope="col">Horas SA</th>
                  <th style={th} scope="col">Horas HE</th>
                </>
              ) : (
                <>
                  <th style={th} scope="col">Horas SA</th>
                  <th style={th} scope="col">Horas HE</th>
                </>
              )
            ) : (
              <>
                <th style={th} scope="col">{SITU_HOURS_LABEL} (valor)</th>
                <th style={th} scope="col">{SITU_HOURS_LABEL} (horas)</th>
              </>
            )}
            {!isSituacional && <th style={th} scope="col">Situação HE</th>}
            <th style={th} scope="col">Estado</th>
            <th style={th} scope="col">Origem</th>
          </tr>
        </thead>
        <tbody>
          {teams.map((tm) => (
            <FragmentForTable key={tm.teamId} tm={tm} renderRows={renderRows} T={T} colSpan={totalCols} />
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: `2px solid ${T.borderStrong}`, background: T.surfaceAlt }}>
            <td colSpan={2} style={{ padding: '0.55rem 0.6rem', fontWeight: 700, color: T.textPrimary }}>Total {MONTH_SHORT(comp.monthKey)}</td>
            {!isSituacional ? (
              metric === 'custo' ? (
                <>
                  {includeRemuneracao && <td className="tnum" style={tdTot(T)}>{comp.total.remuneracao == null ? '—' : brl(comp.total.remuneracao)}</td>}
                  <td className="tnum" style={tdTot(T)}>{comp.total.valorSA == null ? '—' : brl(comp.total.valorSA)}</td>
                  <td className="tnum" style={tdTot(T)}>{comp.total.valorHE == null ? '—' : brl(comp.total.valorHE)}</td>
                  <td className="tnum" style={{ ...tdTot(T), color: comp.total.valorComp == null ? T.textMuted : (comp.total.valorComp > 0 ? T.danger : T.textPrimary) }}>{comp.total.valorComp == null ? '—' : (comp.total.valorComp > 0 ? `− ${brl(comp.total.valorComp)}` : brl(0))}</td>
                  <td className="tnum" style={tdTot(T)}>{comp.total.custo == null ? '—' : brl(comp.total.custo)}</td>
                  <td className="tnum" style={tdTot(T)}>{comp.total.horasSA == null ? '—' : fmtHM(comp.total.horasSA)}</td>
                  <td className="tnum" style={tdTot(T)}>{comp.total.horasHE == null ? '—' : fmtHM(comp.total.horasHE)}</td>
                </>
              ) : (
                <>
                  <td className="tnum" style={tdTot(T)}>{comp.total.horasSA == null ? '—' : fmtHM(comp.total.horasSA)}</td>
                  <td className="tnum" style={tdTot(T)}>{comp.total.horasHE == null ? '—' : fmtHM(comp.total.horasHE)}</td>
                </>
              )
            ) : (
              <>
                <td className="tnum" style={tdTot(T)}>{monthSitu.valorHE == null ? '—' : brl(monthSitu.valorHE)}</td>
                <td className="tnum" style={tdTot(T)}>{monthSitu.horasHE == null ? '—' : fmtHM(monthSitu.horasHE)}</td>
              </>
            )}
            {!isSituacional && <td colSpan={3} />}
            {isSituacional && <td colSpan={2} />}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function FragmentForTable({ tm, renderRows, T, colSpan }) {
  return (
    <>
      <tr style={{ background: T.surfaceAlt, borderTop: `1px solid ${T.borderStrong}` }}>
        <td colSpan={colSpan} style={{ padding: '0.35rem 0.6rem', fontSize: '0.66rem', fontWeight: 700, color: T.textSecondary, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {tm.teamNome}
          {tm.estado !== 'fechado' && tm.estado !== 'sem-dados' && <span style={{ color: T.textMuted, marginLeft: '0.5rem' }}>· {ESTADO_META[tm.estado]?.label}</span>}
        </td>
      </tr>
      {renderRows(tm)}
    </>
  );
}

const TM_NOME = (teamId) => TEAMS[teamId]?.nome || teamId;
export const MONTH_SHORT = (monthKey) => {
  const [y, m] = String(monthKey).split('-');
  return `${MONTHS_SHORT[Number(m) - 1] ?? ''} ${y}`;
};
const tdTot = (T) => ({ textAlign: 'right', padding: '0.55rem 0.6rem', whiteSpace: 'nowrap', fontFamily: T.fontMono, fontSize: '0.8rem', fontWeight: 700, color: T.textPrimary });

// ─── COMPONENTE PRINCIPAL ────────────────────────────────────────────────────
export default function RelatorioCusto({ dark, profile, sources: sourcesProp, api: apiProp }) {
  // Hook sempre chamado, sem ramo condicional (regra de Hooks): o `api` injetado é
  // usado apenas quando a demo/teste o fornece; senão cai no do Clerk (useApi).
  const defaultApi = useApi();
  const api = apiProp ?? defaultApi;
  const T = getTheme(dark);
  const adminOf = profile?.adminOf;

  const [sources, setSources] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const escopo = useMemo(() => chGroupsFor(adminOf), [adminOf]);
  const escopoIds = useMemo(() => escopo.map(t => t.teamId), [escopo]);

  const [teamFilter, setTeamFilter] = useState(null);
  const [personFilter, setPersonFilter] = useState(null);
  const [metric, setMetric] = useState('custo');
  const [situacao, setSituacao] = useState('realizado');
  const [includeRemuneracao, setIncludeRemuneracao] = useState(true);
  const [rangeMonths, setRangeMonths] = useState(12);
  const [selectedMonthKey, setSelectedMonthKey] = useState(null);
  const [selectedTeamId, setSelectedTeamId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (sourcesProp) {
      setSources(sourcesProp);
      setError(null);
      setLoading(false);
      return undefined;
    }
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const s = await loadCustoSources(api, adminOf);
        if (cancelled) return;
        setSources(s);
      } catch (e) {
        if (!cancelled) setError(friendlyError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (adminOf && escopoIds.length) load();
    else { setLoading(false); setSources(null); }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, adminOf, sourcesProp]);

  // seleção inicial: só a Equipe Sustentação (ou a primeira do escopo, se ela não
  // estiver no adminOf) — roda quando o dado chega, seja carregado ou injetado.
  useEffect(() => {
    if (!sources || teamFilter !== null) return;
    const initial = escopoIds.includes('sustentacao') ? ['sustentacao'] : (escopoIds[0] ? [escopoIds[0]] : []);
    setTeamFilter(initial);
    setSelectedTeamId(initial[0] ?? null);
    setSelectedMonthKey(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, escopoIds]);

  const openMonthKey = currentMonthKey();
  const range = useMemo(() => monthKeysForRange(openMonthKey, rangeMonths), [openMonthKey, rangeMonths]);

  const effectiveTeamFilter = useMemo(() => {
    const tf = (teamFilter || []).filter(id => escopoIds.includes(id));
    return tf.length ? tf : (escopoIds[0] ? [escopoIds[0]] : []);
  }, [teamFilter, escopoIds]);

  const dados = useMemo(() => {
    if (!sources) return null;
    return custoConsolidado({
      sources,
      adminOf,
      range,
      openMonthKey,
      teamFilter: effectiveTeamFilter,
      personFilter: personFilter && personFilter.length ? personFilter : null,
      metric,
      situacao,
      includeRemuneracao,
    });
  }, [sources, adminOf, range, openMonthKey, effectiveTeamFilter, personFilter, metric, situacao, includeRemuneracao]);

  const defaultSelectedMonth = range[range.length - 1];
  const selectedMonth = selectedMonthKey && range.includes(selectedMonthKey) ? selectedMonthKey : defaultSelectedMonth;

  // garante que a equipe em foco sempre pertence à seleção
  useEffect(() => {
    if (selectedTeamId && !effectiveTeamFilter.includes(selectedTeamId)) setSelectedTeamId(effectiveTeamFilter[0] ?? null);
  }, [effectiveTeamFilter, selectedTeamId]);

  const selectedComp = useMemo(() => dados?.competencias.find(c => c.monthKey === selectedMonth) || null, [dados, selectedMonth]);

  const effectiveSituacao = metric === 'horasSA' ? 'realizado' : situacao;
  // A composição por componente só existe para o custo REALIZADO; pendente/rejeitado
  // são um valor potencial único (bloco `situacoes[situ]`), sem quebra por componente.
  const chartMode = metric === 'custo' && effectiveSituacao === 'realizado' && effectiveTeamFilter.length === 1 ? 'stacked' : 'grouped';

  // consolida visualistas (mês → equipes → série) para o gráfico. Lê o bloco
  // `situacoes[situacao]` em cada nível — forma uniforme: o mesmo bloco alimenta
  // custo e horas de HE, e nunca mistura potencial com o realizado.
  const dadosChart = useMemo(() => {
    if (!dados) return [];
    return dados.competencias.map(c => ({
      monthKey: c.monthKey,
      estado: c.estado,
      teams: c.equipes.map(e => {
        const total = e.total;
        const bloco = (total.situacoes && total.situacoes[effectiveSituacao]) || {};
        const value = metric === 'custo' ? bloco.custo
          : metric === 'horasSA' ? total.horasSA
          : bloco.horasHE;
        const stacked = metric === 'custo' && effectiveSituacao === 'realizado' ? [
          { kind: 'remuneracao', value: total.remuneracao },
          { kind: 'sobreaviso', value: total.valorSA },
          { kind: 'horaExtra', value: total.valorHE },
          { kind: 'compensacao', value: total.valorComp },
        ] : null;
        return { teamId: e.teamId, teamNome: e.teamNome, value, stacked, estado: e.estado };
      }),
    }));
  }, [dados, metric, effectiveSituacao]);

  const indicadores = dados?.indicadores || null;

  const onSelectMonth = (monthKey) => {
    setSelectedMonthKey(monthKey);
    setSelectedTeamId(null);
  };
  const onSelectTeam = (teamId) => {
    const t = effectiveTeamFilter.length === 1 ? effectiveTeamFilter[0] : teamId;
    if (selectedTeamId === t && effectiveTeamFilter.length === 1) return;
    setSelectedTeamId(t);
  };

  const toggleTeam = (teamId) => {
    setTeamFilter((prev) => {
      const cur = prev && prev.length ? prev : effectiveTeamFilter;
      if (cur.includes(teamId)) {
        if (cur.length === 1) return cur; // nunca remover a última
        return cur.filter(id => id !== teamId);
      }
      return [...cur, teamId];
    });
  };

  const togglePerson = (personName) => {
    setPersonFilter((prev) => {
      const cur = prev && prev.length ? prev : null;
      if (!cur) return [personName];
      if (cur.includes(personName)) {
        if (cur.length === 1) return null;
        return cur.filter(p => p !== personName);
      }
      return [...cur, personName];
    });
  };

  const anyPendente = (indicadores?.pendenciaHE?.horas || 0) > 0;
  const anyRejeitado = (indicadores?.rejeitadoHE?.horas || 0) > 0;
  // Integridade de snapshot: `riscos` só é preenchido quando um snapshot perdeu
  // componente (o real indisponível) — meses "sem dados" (equipe inexistente) NÃO
  // entram, senão o aviso dispararia em falso. `competenciasIndisponiveis` exclui
  // os "sem dados" também; o consumidor usa o mesmo nome exato do Ledger.
  const temRiscos = (indicadores?.riscos?.length || 0) > 0;
  const competenciasIndisponiveis = indicadores?.competenciasIndisponiveis || 0;
  const situ = effectiveSituacao;
  // Bloco uniforme da situação ativa — a UI lê `situacoes[situacao]` (contracto do
  // Ledger): Realizado é o custo oficial; Pendente/Rejeitado são potencial, NUNCA
  // somados ao realizado. Sem misturar métricas entre situações.
  const situInd = (indicadores?.situacoes && indicadores.situacoes[situ]) || null;
  const situMes = (selectedComp?.total?.situacoes && selectedComp.total.situacoes[situ]) || null;
  const custoPeriodoExibido = situInd?.custo ?? null;
  const custoMesExibido = situMes?.custo ?? null;
  const horasExtrasExibidas = situInd?.horasHE ?? 0;
  const horasExtrasSub = situ === 'pendente' ? 'pendentes' : situ === 'rejeitado' ? 'rejeitadas' : 'realizadas';
  const custoPeriodoLabel = situ === 'pendente' ? 'Pendência HE (potencial)' : situ === 'rejeitado' ? 'Rejeição HE (potencial)' : includeRemuneracao ? 'Custo do período' : 'Custo variável';
  const metricMeta = { ...METRIC_META[metric], label: metric === 'custo' ? (includeRemuneracao ? 'Custo Mensal' : 'Custo Variável') : METRIC_META[metric].label };

  const exportCSV = () => {
    if (!dados) return;
    const csv = buildCustoCsv(dados, { metric, situacao, includeRemuneracao });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio-custo_${range[0]}-a-${range[range.length - 1]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const printPDF = () => window.print();

  // estados / derivados de renderização
  const emptyStateStyle = {
    background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.rPanel,
    color: T.textMuted, padding: '1.5rem', textAlign: 'center', fontSize: '0.85rem', marginBottom: '1rem',
  };

  if (loading) {
    return (
      <div role="status" style={emptyStateStyle}>
        Carregando a visão de custo…
      </div>
    );
  }
  if (error) {
    return (
      <p role="alert" className="flex items-center gap-1.5 mb-3" style={{ color: T.danger, fontSize: '0.82rem', fontWeight: 600 }}>
        <Icon name="alert" size={14} /> {error}
      </p>
    );
  }
  if (escopo.length === 0) {
    return (
      <div style={emptyStateStyle}>
        Você não administra nenhuma equipe — a visão de custo fica disponível somente para administradores.
      </div>
    );
  }
  if (!dados || !selectedComp) {
    return (
      <div role="status" style={emptyStateStyle}>
        Sem dados para o período selecionado.
      </div>
    );
  }

  const legend = chartMode === 'stacked'
    ? ['remuneracao', 'sobreaviso', 'horaExtra', 'compensacao']
    : effectiveTeamFilter.map(id => ({ teamId: id }));

  return (
    <div className="print-custo">
      {/* RESUMO TEXTUAL — sempre presente, responde a seleção atual sem depender do gráfico */}
      <p role="status" aria-live="polite" style={{ fontSize: '0.8rem', color: T.textSecondary, margin: '0 0 0.8rem', lineHeight: 1.5 }}>
        <b style={{ color: T.textPrimary }}>{metricMeta.label}</b>
        {metric === 'custo' && (includeRemuneracao ? ' com remuneração incluída' : ' sem remuneração (custo variável)')}
        {' · '}{range[0] === range[range.length - 1] ? range[0] : `${range[0]} a ${range[range.length - 1]}`}
        {metric !== 'horasSA' && (effectiveSituacao !== 'realizado' ? ` · situação ${effectiveSituacao}` : '')}
        {effectiveTeamFilter.length === 1 ? ` · equipe: ${TEAMS[effectiveTeamFilter[0]]?.nome}` : ` · equipes: ${effectiveTeamFilter.map(id => TEAMS[id]?.nome).join(', ')}`}
      </p>

      {/* ALERTA DE PENDÊNCIA — só no contexto "Realizado" (a visão oficial): avisa
          que há lançamentos de HE fora do custo, sem somá-los. No filtro Pendente/
          Rejeitado o próprio gráfico/indicadores já mostram o potencial. */}
      {situ === 'realizado' && (anyPendente || anyRejeitado) && (
        <div role="alert" className="flex items-start gap-2.5 mb-3"
          style={{ background: T.warnQuiet, border: `1px solid ${T.warnBorder}`, borderRadius: T.rPanel, padding: '0.7rem 0.85rem' }}>
          <Icon name="alert" size={15} style={{ color: T.warn, flexShrink: 0, marginTop: '0.15rem' }} />
          <div style={{ fontSize: '0.82rem', lineHeight: 1.5 }}>
            <b style={{ color: T.textPrimary }}>Há lançamentos de Hora Extra fora do realizado</b>
            {anyPendente && (
              <div style={{ fontSize: '0.76rem', marginTop: '0.2rem', color: T.textSecondary }}>
                Pendente: {fmtHM(indicadores.pendenciaHE.horas)} · potencial {brl(indicadores.pendenciaHE.valor)}
              </div>
            )}
            {anyRejeitado && (
              <div style={{ fontSize: '0.76rem', marginTop: '0.2rem', color: T.textSecondary }}>
                Rejeitada: {fmtHM(indicadores.rejeitadoHE.horas)} · potencial {brl(indicadores.rejeitadoHE.valor)}
              </div>
            )}
            <div style={{ fontSize: '0.76rem', marginTop: '0.2rem', color: T.textSecondary }}>
              Pendências e rejeições não entram no custo realizado.
            </div>
          </div>
        </div>
      )}

      {/* INTEGRIDADE DE SNAPSHOT — componente indisponível nunca vira zero:
          exibimos como "—" e avisamos explicitamente. */}
      {(temRiscos || competenciasIndisponiveis > 0) && (
        <div role="alert" className="flex items-start gap-2.5 mb-3"
          style={{ background: T.dangerQuiet, border: `1px solid ${T.dangerBorder}`, borderRadius: T.rPanel, padding: '0.7rem 0.85rem' }}>
          <Icon name="alert" size={15} style={{ color: T.danger, flexShrink: 0, marginTop: '0.15rem' }} />
          <div style={{ fontSize: '0.82rem', lineHeight: 1.5 }}>
            <b style={{ color: T.textPrimary }}>Dados indisponíveis no snapshot</b>
            {competenciasIndisponiveis > 0 && (
              <div style={{ fontSize: '0.76rem', marginTop: '0.2rem', color: T.textSecondary }}>
                {competenciasIndisponiveis} competência(s) com componente indisponível — exibida(s) como "—", nunca como zero.
              </div>
            )}
            {temRiscos && (
              <div style={{ fontSize: '0.76rem', marginTop: '0.2rem', color: T.textSecondary }}>
                Registros: {indicadores.riscos.join('; ')}.
              </div>
            )}
            <div style={{ fontSize: '0.76rem', marginTop: '0.2rem', color: T.textSecondary }}>
              Valores sem dado não são inventados: permanecem "—" até a fonte estar disponível.
            </div>
          </div>
        </div>
      )}

      {/* FILTROS */}
      <Panel T={T} className="print-hide" style={{ padding: '0.85rem', marginBottom: '1rem' }}>
        <div className="flex flex-wrap gap-x-5 gap-y-4 items-end">
          <div>
            <div id="rc-metric" style={{ fontSize: '0.72rem', fontWeight: 600, color: T.labelColor, display: 'block', marginBottom: '0.35rem' }}>Métrica</div>
            <Segmented T={T} className="rc-seg" role="group" aria-labelledby="rc-metric">
              {['custo', 'horasSA', 'horasHE'].map((m, i) => (
                <SegmentedItem key={m} T={T} active={metric === m} first={i === 0} onClick={() => setMetric(m)}>
                  {METRIC_META[m].short}
                </SegmentedItem>
              ))}
            </Segmented>
          </div>

          {metric !== 'horasSA' && (
            <div>
              <div id="rc-situacao" style={{ fontSize: '0.72rem', fontWeight: 600, color: T.labelColor, display: 'block', marginBottom: '0.35rem' }}>Situação</div>
              <Segmented T={T} className="rc-seg" role="group" aria-labelledby="rc-situacao">
                {['realizado', 'pendente', 'rejeitado'].map((s, i) => (
                  <SegmentedItem key={s} T={T} active={situacao === s} first={i === 0} onClick={() => setSituacao(s)}>
                    {s === 'realizado' ? 'Realizado' : s === 'pendente' ? 'Pendente' : 'Rejeitado'}
                  </SegmentedItem>
                ))}
              </Segmented>
            </div>
          )}

          {metric === 'custo' && (
            <div>
              <div id="rc-remun" style={{ fontSize: '0.72rem', fontWeight: 600, color: T.labelColor, display: 'block', marginBottom: '0.35rem' }}>Remuneração</div>
              <Segmented T={T} className="rc-seg" role="group" aria-labelledby="rc-remun">
                <SegmentedItem T={T} active={includeRemuneracao} first onClick={() => setIncludeRemuneracao(true)}>Incluída</SegmentedItem>
                <SegmentedItem T={T} active={!includeRemuneracao} onClick={() => setIncludeRemuneracao(false)}>Excluída</SegmentedItem>
              </Segmented>
            </div>
          )}

          <div>
            <label htmlFor="rc-range" style={{ fontSize: '0.72rem', fontWeight: 600, color: T.labelColor, display: 'block', marginBottom: '0.35rem' }}>Intervalo</label>
            <div className="inline-flex items-center gap-2">
              <select id="rc-range" value={rangeMonths} onChange={e => setRangeMonths(Number(e.target.value))}
                style={{ background: T.inputBg, color: T.textPrimary, border: `1px solid ${T.inputBorder}`, borderRadius: T.rControl, padding: '0.45rem 0.55rem', minHeight: '2.75rem', fontSize: '0.82rem', colorScheme: T.dark ? 'dark' : 'light' }}>
                <option value={6}>6 meses</option>
                <option value={12}>12 meses</option>
                <option value={18}>18 meses</option>
                <option value={24}>24 meses</option>
              </select>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <Button T={T} size="sm" variant="secondary" onClick={exportCSV} style={{ minHeight: '2.75rem' }}>
              <Icon name="download" size={14} /> Exportar CSV
            </Button>
            <Button T={T} size="sm" variant="secondary" onClick={printPDF} aria-label="Imprimir ou salvar a visão em PDF" style={{ minHeight: '2.75rem' }}>
              Imprimir / PDF
            </Button>
          </div>
        </div>
      </Panel>

      {/* SELETORES DE EQUIPE E PESSOA */}
      <Panel T={T} className="print-hide" style={{ padding: '0.85rem', marginBottom: '1rem' }}>
        <SectionLabel T={T}>Equipes (escopo {adminOf === '*' ? 'completo' : 'do seu admin'})</SectionLabel>
        <div className="flex flex-wrap gap-2 mt-2">
          {dados.escopo.map((t) => {
            const tone = teamTone(t.teamId, dark);
            const active = effectiveTeamFilter.includes(t.teamId);
            return (
              <button key={t.teamId} type="button" aria-pressed={active} onClick={() => toggleTeam(t.teamId)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', background: active ? tone.fill : 'transparent', color: active ? T.accentInk : T.textSecondary, border: `1px solid ${active ? tone.fill : T.border}`, borderRadius: T.rChip, padding: '0.4rem 0.7rem', minHeight: '2.75rem', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '2px', background: active ? T.accentInk : tone.fill }} />
                {t.nome}
              </button>
            );
          })}
        </div>

        <SectionLabel T={T} style={{ marginTop: '1rem' }}>Pessoas</SectionLabel>
        <div className="flex flex-wrap gap-2 mt-2">
          {([...new Set(effectiveTeamFilter.flatMap(id => TEAMS[id]?.roster || []))]).map((name) => {
            const active = !personFilter || personFilter.includes(name);
            const tone = memberTone(name, dark);
            return (
              <button key={name} type="button" aria-pressed={active} onClick={() => togglePerson(name)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', background: active ? tone.tint : 'transparent', color: active ? T.textPrimary : T.textMuted, border: `1px solid ${active ? tone.ink : T.border}`, boxShadow: active ? `inset 0 0 0 1px ${tone.ink}` : 'none', borderRadius: T.rChip, padding: '0.35rem 0.6rem', minHeight: '2.75rem', fontSize: '0.78rem', fontWeight: active ? 700 : 600, cursor: 'pointer', opacity: active ? 1 : 0.6, transition: 'background 0.12s, border-color 0.12s, color 0.12s, opacity 0.12s' }}>
                <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: active ? tone.ink : tone.dot }} />
                {name}
                {active && <Icon name="check" size={12} style={{ color: tone.ink }} />}
              </button>
            );
          })}
        </div>
        <p style={{ fontSize: '0.72rem', color: T.textMuted, margin: '0.6rem 0 0' }}>
          Toque numa equipe para alternar. Com uma equipe, o custo mostra a composição por componente; com várias, a comparação entre equipes.
        </p>
      </Panel>

      {/* INDICADORES */}
      <div className="grid gap-2 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <IndicatorTile T={T} label={custoPeriodoLabel} value={custoPeriodoExibido == null ? '—' : brl(custoPeriodoExibido)} sub={situ === 'realizado' ? `${range.length} meses` : 'não somado ao realizado'} tone="accent" />
        <IndicatorTile T={T} label={`Custo · ${MONTH_SHORT(selectedMonth)}`} value={custoMesExibido == null ? '—' : brl(custoMesExibido)} sub={situ === 'realizado' ? ESTADO_META[selectedComp.estado]?.label : `situação ${situ}`} tone={situ === 'realizado' ? ESTADO_META[selectedComp.estado]?.tone : 'warn'} />
        <IndicatorTile T={T} label="Horas de Sobreaviso" value={indicadores.horasSobreaviso == null ? '—' : fmtHM(indicadores.horasSobreaviso)} sub="no período" tone="info" />
        <IndicatorTile T={T} label="Horas Extras" value={horasExtrasExibidas == null ? '—' : fmtHM(horasExtrasExibidas)} sub={horasExtrasSub} tone="success" />
      </div>

      {/* GRÁFICO */}
      <Panel T={T} style={{ marginBottom: '1rem', overflow: 'hidden' }}>
        <div style={{ padding: '0.8rem 0.9rem', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2 style={{ fontSize: '0.9rem', fontWeight: 700, color: T.textPrimary, margin: 0, letterSpacing: '-0.01em' }}>
            {metricMeta.label}
            <span style={{ fontWeight: 400, color: T.textMuted }}>{' · '}{range[0] === range[range.length - 1] ? range[0] : `${range[0]} a ${range[range.length - 1]}`}</span>
          </h2>
          <div className="flex items-center gap-4 flex-wrap" style={{ fontSize: '0.68rem', color: T.textMuted }}>
            {Object.keys(ESTADO_META).map((k) => (
              <span key={k} className="inline-flex items-center gap-1">
                <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: ESTADO_META[k].tone === 'success' ? T.success : ESTADO_META[k].tone === 'info' ? T.info : ESTADO_META[k].tone === 'warn' ? T.warn : T.textMuted }} />
                {ESTADO_META[k].label}
              </span>
            ))}
          </div>
        </div>

        <div style={{ padding: '0.7rem 0.9rem 0.8rem' }}>
          {dadosChart.every(c => (c.teams || []).every(t => t.value == null)) ? (
            <div style={{ ...emptyStateStyle, marginBottom: 0 }}>Sem atividade para o período — os meses anteriores ao início das equipes aparecem como sem dados, não como custo zero.</div>
          ) : (
            <CustoChart
              dadosChart={dadosChart} mode={chartMode} metric={metric} situacao={effectiveSituacao}
              selectedMonth={selectedMonth} selectedTeamId={selectedTeamId} dark={dark} T={T}
              onSelectMonth={onSelectMonth} onSelectTeam={onSelectTeam}
            />
          )}

          {/* LEGENDA dos componentes ou das equipes */}
          <div className="flex items-center gap-4 flex-wrap mt-3" style={{ fontSize: '0.72rem', color: T.textSecondary }}>
            {chartMode === 'stacked' ? (
              Object.keys(COMPONENT_LABELS).map((k) => {
                const tone = componentTone(k, dark);
                return (
                  <span key={k} className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '2px', background: tone.fill }} />
                    {COMPONENT_LABELS[k]}{k === 'compensacao' && <span style={{ color: T.textMuted }}>(abate)</span>}
                  </span>
                );
              })
            ) : (
              effectiveTeamFilter.map((id) => {
                const tone = teamTone(id, dark);
                const active = selectedTeamId === id;
                return (
                  <button key={id} type="button" aria-pressed={active} onClick={() => onSelectTeam(id)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: 'transparent', color: active ? T.textPrimary : T.textMuted, border: 'none', borderRadius: T.rChip, padding: '0.25rem 0.4rem', minHeight: '2.75rem', cursor: 'pointer', fontWeight: active ? 700 : 600 }}>
                    <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '2px', background: tone.fill }} />
                    {TEAMS[id]?.nome}
                  </button>
                );
              })
            )}
            {metric === 'custo' && (
              <span className="inline-flex items-center gap-1.5" style={{ color: T.textMuted }}>
                <Icon name="info" size={12} /> Compensação reduz o custo
              </span>
            )}
          </div>
        </div>
      </Panel>

      {/* DETALHAMENTO */}
      <Panel T={T} style={{ overflow: 'hidden', marginBottom: '1rem' }}>
        <div style={{ padding: '0.8rem 0.9rem', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2 style={{ fontSize: '0.9rem', fontWeight: 700, color: T.textPrimary, margin: 0 }}>
            Detalhamento · {MONTH_SHORT(selectedMonth)}
            <span style={{ fontWeight: 400, color: T.textMuted }}>
              {selectedTeamId ? ` · ${TEAMS[selectedTeamId]?.nome}` : ` · ${effectiveTeamFilter.map(id => TEAMS[id]?.nome).join(', ')}`}
            </span>
          </h2>
          <Badge T={T} tone={ESTADO_META[selectedComp.estado]?.tone} icon={ESTADO_META[selectedComp.estado]?.icon}>{ESTADO_META[selectedComp.estado]?.label}</Badge>
        </div>
        <DetailTable comp={selectedComp} metric={metric} includeRemuneracao={includeRemuneracao} situacao={situacao} dark={dark} T={T} selectedTeamId={selectedTeamId} />
      </Panel>
    </div>
  );
}
