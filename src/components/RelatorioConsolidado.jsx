import { useState, useEffect, useMemo, Fragment } from 'react';
import { useApi } from '../lib/api';
import { MONTHS, fmtHM, brl, buildSchedule } from '../lib/schedule';
import { scheduleEntriesFor, monthTotals, isEntryCountable } from '../lib/chCalc';
import { TEAMS, MEMBERS, chGroupsFor } from '../lib/teams';
import { getTheme, memberTone } from '../lib/theme';
import { Icon, Badge, Button, Panel, SectionLabel, friendlyError } from './ui';

// Relatório consolidado do Controle de Horas (admin) — uma linha por pessoa das
// equipes em profile.adminOf, agrupada por equipe: o insumo que o admin usa para
// fechar a folha do mês, em vez de abrir pessoa por pessoa.
//
// Mês fechado usa o snapshot (member:{id}:ch_closed[YYYY-MM]) — nunca recalcula, pelo
// mesmo motivo do painel individual: um relatório que recalcula um mês já fechado pode
// divergir do que já foi de fato pago.
//
// ⚠ Fórmula: valorSA = (valorHora/3) × horas INTEGRAIS de sobreaviso, sem descontar
// horas de HE — mesma fórmula do painel individual (src/lib/chCalc.js), não inventada
// aqui. As planilhas que a equipe usa hoje descontam HE/Comp do SA antes de multiplicar
// por 1/3; os valores deste relatório são por isso MAIORES que os da planilha — decisão
// conhecida (ver nota fixa na tela e no CSV), não é bug.
//
// Registro visual: esta é a tela de fechamento financeiro, o caso mais forte do
// registro de console (PRODUCT.md — régua Grafana/Datadog). Por isso: numeral
// tabular + fonte mono em TODA célula de hora ou dinheiro, colunas numéricas
// alinhadas à direita, hairline de 1px separando as linhas (nunca card por
// pessoa), cabeçalho de grupo calmo por equipe e linha de total visualmente mais
// pesada. Nenhuma cor hardcoded — os avisos usam os tokens semânticos do tema
// (antes a nota de fórmula tinha #FEF9C3 fixo, um amarelo de tema claro que era
// renderizado também no escuro).

function monthKeyOf(monthIdx, year) {
  return `${year}-${String(monthIdx + 1).padStart(2, '0')}`;
}

// Arredonda para centavos ANTES de guardar no estado da linha — nunca depois. Assim a
// soma exibida no rodapé é a soma dos valores exatamente como aparecem na tela (e no
// CSV), nunca "soma dos valores crus, arredondada só no final" — que pode divergir por
// centavos quando há várias linhas (é insumo de pagamento, não pode haver essa dúvida).
const roundCents = (v) => Math.round((v || 0) * 100) / 100;
// Mesma ideia para horas: fmtHM já arredonda para o minuto na exibição — arredondar
// aqui também garante que a soma das horas exibidas bate com a hora total exibida.
const roundMinutes = (h) => Math.round((h || 0) * 60) / 60;

function buildRow({ person, teamId, teamNome, closed, sobreaviso, valorSobreaviso, extra, valorExtra, comp, valorComp }) {
  const horasSA = roundMinutes(sobreaviso);
  const valorSA = roundCents(valorSobreaviso);
  const horasHE = roundMinutes(extra);
  const valorHE = roundCents(valorExtra);
  const compR = roundMinutes(comp);
  const valorCompR = roundCents(valorComp);
  const valorTotal = roundCents(valorSA + valorHE - valorCompR);
  return { person, teamId, teamNome, closed, horasSA, valorSA, horasHE, valorHE, comp: compR, valorComp: valorCompR, valorTotal };
}

export default function RelatorioConsolidado({ dark, profile, monthIdx, year }) {
  const api = useApi();
  const T = getTheme(dark);

  const groups = useMemo(() => chGroupsFor(profile?.adminOf), [profile]);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Ajustes manuais (ex.: "diferença de reajuste") — somam ao total geral, mas NÃO são
  // persistidos nesta versão (limitação conhecida, ver nota na tela). Resetam ao trocar
  // de mês porque não haveria como saber se ainda fazem sentido no mês novo.
  const [adjustments, setAdjustments] = useState([]);
  const [adjForm, setAdjForm] = useState({ desc: '', valor: '' });

  useEffect(() => setAdjustments([]), [monthIdx, year]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const monthKeyStr = monthKeyOf(monthIdx, year);
      try {
        const teamIds = groups.map(g => g.teamId);
        const teamDataEntries = await Promise.all(teamIds.map(async (teamId) => {
          const [schedData, subsData] = await Promise.all([
            api(`/api/schedule?team=${teamId}`),
            api(`/api/substitutions?team=${teamId}`),
          ]);
          return [teamId, { overrides: schedData?.overrides || {}, subs: subsData || [] }];
        }));
        const teamData = Object.fromEntries(teamDataEntries);

        const allPeople = groups.flatMap(g => g.people.map(person => ({ person, teamId: g.teamId, teamNome: g.nome })));

        const peopleRows = await Promise.all(allPeople.map(async ({ person, teamId, teamNome }) => {
          const [chData, closedData] = await Promise.all([
            api(`/api/ch?person=${encodeURIComponent(person)}`),
            api(`/api/ch-close?person=${encodeURIComponent(person)}`).catch(() => ({})),
          ]);
          const closedSnap = closedData?.[monthKeyStr] || null;

          if (closedSnap) {
            const t = closedSnap.totals || {};
            return buildRow({
              person, teamId, teamNome, closed: true,
              sobreaviso: t.sobreaviso || 0, valorSobreaviso: t.valorSobreaviso || 0,
              extra: t.extra || 0, valorExtra: t.valorExtra || 0,
              comp: t.comp || 0, valorComp: t.valorComp || 0,
            });
          }

          const team = TEAMS[teamId];
          const { subs, overrides } = teamData[teamId];
          const schedule = buildSchedule(team, overrides);
          const scheduleEntries = scheduleEntriesFor(schedule, subs, person, monthIdx, year);
          // Hora Extra pendente ou rejeitada não entra no relatório — mesma
          // regra do painel individual (ver src/lib/chCalc.js, isEntryCountable).
          const manualEntries = (chData.entries || []).filter(e => {
            if (e.person !== person) return false;
            if (!isEntryCountable(e)) return false;
            const d = new Date(e.data + "T12:00:00");
            return d.getMonth() === monthIdx && d.getFullYear() === year;
          });
          const rawParams = chData.params?.[person] || { remuneracao: 0, jornada: 168 };
          const valorHora = (Number(rawParams.remuneracao) || 0) / (Number(rawParams.jornada) || 168);
          const t = monthTotals([...scheduleEntries, ...manualEntries], valorHora);
          return buildRow({
            person, teamId, teamNome, closed: false,
            sobreaviso: t.sobreaviso, valorSobreaviso: t.valorSobreaviso,
            extra: t.extra, valorExtra: t.valorExtra,
            comp: t.comp, valorComp: t.valorComp,
          });
        }));

        if (!cancelled) setRows(peopleRows);
      } catch (e) {
        if (!cancelled) setError(friendlyError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (groups.length) load(); else { setRows([]); setLoading(false); }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.adminOf, monthIdx, year]);

  const rowsByTeam = useMemo(() => {
    const byTeam = {};
    rows.forEach(r => { (byTeam[r.teamId] ||= []).push(r); });
    return byTeam;
  }, [rows]);

  // Soma as linhas EXATAMENTE como cada uma já foi arredondada em buildRow() — nunca
  // recalcula SA+HE−Comp aqui. É o que garante que "soma da coluna Valor Total" e
  // "total geral exibido" sejam sempre o mesmo número, centavo a centavo.
  const grandTotals = useMemo(() => rows.reduce((acc, r) => ({
    horasSA: roundMinutes(acc.horasSA + r.horasSA),
    valorSA: roundCents(acc.valorSA + r.valorSA),
    horasHE: roundMinutes(acc.horasHE + r.horasHE),
    valorHE: roundCents(acc.valorHE + r.valorHE),
    comp: roundMinutes(acc.comp + r.comp),
    valorComp: roundCents(acc.valorComp + r.valorComp),
    valorTotal: roundCents(acc.valorTotal + r.valorTotal),
  }), { horasSA: 0, valorSA: 0, horasHE: 0, valorHE: 0, comp: 0, valorComp: 0, valorTotal: 0 }), [rows]);

  const adjustmentsTotal = useMemo(() => roundCents(adjustments.reduce((a, j) => a + (Number(j.valor) || 0), 0)), [adjustments]);
  const grandTotalWithAdjustments = roundCents(grandTotals.valorTotal + adjustmentsTotal);

  const addAdjustment = () => {
    const valor = Number(adjForm.valor);
    if (!adjForm.desc.trim() || !Number.isFinite(valor) || valor === 0) return;
    setAdjustments(a => [...a, { id: crypto.randomUUID(), desc: adjForm.desc.trim(), valor }]);
    setAdjForm({ desc: '', valor: '' });
  };
  const removeAdjustment = (id) => setAdjustments(a => a.filter(j => j.id !== id));

  const FORMULA_NOTE = "Sobreaviso a ⅓ sobre as horas integrais da escala; horas extras não são descontadas do sobreaviso.";
  const FORMULA_NOTE_2 = "Por isso estes valores podem ser maiores que os das planilhas atuais (que descontam HE e Compensação do SA) — decisão conhecida, não é erro.";

  const exportCSV = () => {
    const sep = ";";
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const header = ["Colaborador", "Horas SA", "Valor SA", "Horas HE", "Valor HE", "Compensação", "Valor Total"];
    const lines = [header.map(q).join(sep)];

    groups.forEach(g => {
      const teamRows = rowsByTeam[g.teamId] || [];
      if (!teamRows.length) return;
      lines.push([g.nome].map(q).join(sep));
      teamRows.forEach(r => {
        const fullName = MEMBERS[r.person]?.fullName || r.person;
        lines.push([
          r.closed ? `${fullName} (mês fechado)` : fullName,
          fmtHM(r.horasSA), brl(r.valorSA),
          fmtHM(r.horasHE), brl(r.valorHE),
          brl(r.valorComp),
          brl(r.valorTotal),
        ].map(q).join(sep));
      });
    });

    lines.push('');
    lines.push(["TOTAL GERAL",
      fmtHM(grandTotals.horasSA), brl(grandTotals.valorSA),
      fmtHM(grandTotals.horasHE), brl(grandTotals.valorHE),
      brl(grandTotals.valorComp), brl(grandTotals.valorTotal),
    ].map(q).join(sep));

    if (adjustments.length) {
      lines.push('');
      lines.push(["AJUSTES MANUAIS (não persistidos)"].map(q).join(sep));
      adjustments.forEach(j => lines.push([j.desc, "", "", "", "", "", brl(j.valor)].map(q).join(sep)));
      lines.push(["TOTAL GERAL COM AJUSTES", "", "", "", "", "", brl(grandTotalWithAdjustments)].map(q).join(sep));
    }

    lines.push('');
    lines.push(["FÓRMULA", FORMULA_NOTE].map(q).join(sep));
    lines.push(["", FORMULA_NOTE_2].map(q).join(sep));

    const csv = "﻿" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `relatorio-consolidado_${MONTHS[monthIdx]}-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Input e células — tokens do sistema; raio de controle (5px), nunca 0.5rem solto.
  const inputStyle = {
    background: T.inputBg, color: T.textPrimary,
    border: `1px solid ${T.inputBorder}`,
    borderRadius: T.rControl, padding: "0.5rem 0.6rem", minHeight: "2.5rem",
    fontSize: "0.85rem",
  };
  const thStyle = {
    textAlign: "right", fontSize: "0.66rem", fontWeight: 700, letterSpacing: "0.05em",
    textTransform: "uppercase", color: T.textMuted, padding: "0.5rem 0.6rem", whiteSpace: "nowrap",
  };
  const thStyleLeft = { ...thStyle, textAlign: "left" };
  // Toda célula numérica: mono + tabular-nums (className="tnum"). Sem largura fixa
  // de dígito uma coluna de valores não alinha e o olho perde a comparação.
  const tdNum = {
    textAlign: "right", padding: "0.4rem 0.6rem", whiteSpace: "nowrap",
    fontFamily: T.fontMono, fontSize: "0.8rem", color: T.textSecondary,
  };
  const tdNumTotal = { ...tdNum, fontWeight: 700, color: T.textPrimary };

  const emptyStateStyle = {
    background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.rPanel,
    color: T.textMuted, padding: "1.5rem", textAlign: "center", fontSize: "0.85rem",
    marginBottom: "1rem",
  };

  return (
    <div>
      {/* NOTA DE FÓRMULA — fixa, não removível (insumo de pagamento, precisa estar
          sempre visível). Tokens semânticos de aviso, um em cada tema. */}
      <div role="note" className="flex items-start gap-2.5 mb-4"
        style={{ background: T.warnQuiet, border: `1px solid ${T.warnBorder}`, borderRadius: T.rPanel, padding: "0.7rem 0.85rem" }}>
        <Icon name="alert" size={15} style={{ color: T.warn, flexShrink: 0, marginTop: '0.15rem' }} />
        <div style={{ fontSize: "0.82rem", lineHeight: 1.5 }}>
          <b style={{ color: T.textPrimary }}>{FORMULA_NOTE}</b>
          <div style={{ fontSize: "0.76rem", marginTop: "0.2rem", color: T.textSecondary }}>{FORMULA_NOTE_2}</div>
        </div>
      </div>

      {error && (
        <p role="alert" className="flex items-center gap-1.5 mb-3" style={{ color: T.danger, fontSize: "0.82rem", fontWeight: 600 }}>
          <Icon name="alert" size={14} /> {error}
        </p>
      )}

      {loading ? (
        <div role="status" style={emptyStateStyle}>
          Carregando o relatório de {MONTHS[monthIdx]} de {year}…
        </div>
      ) : groups.length === 0 ? (
        <div style={emptyStateStyle}>
          Você não administra nenhuma equipe.
        </div>
      ) : (
        // Painel: borda, sem sombra (regra de elevação do sistema).
        <div className="mb-4" style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.rPanel, overflow: "hidden" }}>
          <div className="flex items-center justify-between flex-wrap gap-2"
            style={{ padding: "0.7rem 0.8rem", borderBottom: `1px solid ${T.border}` }}>
            <h2 style={{ fontSize: "0.9rem", fontWeight: 700, color: T.textPrimary, margin: 0, letterSpacing: "-0.01em" }}>
              {MONTHS[monthIdx]} de {year}
              <span style={{ fontWeight: 400, color: T.textMuted }}>
                {' · '}<span className="tnum">{rows.length}</span> pessoa{rows.length !== 1 ? "s" : ""}
              </span>
            </h2>
            <Button T={T} size="sm" variant="secondary" onClick={exportCSV} disabled={rows.length === 0}>
              <Icon name="download" size={14} /> Exportar CSV
            </Button>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="w-full" style={{ borderCollapse: "collapse", minWidth: "760px", fontSize: "0.82rem" }}>
              <thead>
                <tr style={{ background: T.surfaceSunken, borderBottom: `1px solid ${T.border}` }}>
                  <th style={thStyleLeft} scope="col">Colaborador</th>
                  <th style={thStyle} scope="col">Horas SA</th>
                  <th style={thStyle} scope="col">Valor SA</th>
                  <th style={thStyle} scope="col">Horas HE</th>
                  <th style={thStyle} scope="col">Valor HE</th>
                  <th style={thStyle} scope="col">Compensação</th>
                  <th style={thStyle} scope="col">Valor Total</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(g => {
                  const teamRows = rowsByTeam[g.teamId] || [];
                  if (!teamRows.length) return null;
                  return (
                    <Fragment key={g.teamId}>
                      {/* Cabeçalho de grupo: uma faixa calma por equipe, não uma
                          coluna repetida em toda linha. */}
                      <tr style={{ background: T.surfaceAlt, borderTop: `1px solid ${T.borderStrong}` }}>
                        <td colSpan={7} style={{ padding: "0.35rem 0.6rem", fontSize: "0.66rem", fontWeight: 700, color: T.textSecondary, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                          {g.nome}
                        </td>
                      </tr>
                      {teamRows.map(r => {
                        const fullName = MEMBERS[r.person]?.fullName || r.person;
                        const tone = memberTone(r.person, dark);
                        return (
                          <tr key={r.person} style={{ borderTop: `1px solid ${T.border}` }}>
                            <td style={{ padding: "0.4rem 0.6rem" }}>
                              <span className="inline-flex items-center gap-2 flex-wrap">
                                {/* Cor por pessoa (PRODUCT.md: intocável) — matiz em
                                    OKLCH com lightness fixa, contraste uniforme. */}
                                <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: tone.dot }} />
                                <span style={{ color: T.textPrimary, fontWeight: 600 }}>{fullName}</span>
                                {r.closed && <Badge T={T} tone="info" icon="check">mês fechado</Badge>}
                              </span>
                            </td>
                            <td className="tnum" style={tdNum}>{fmtHM(r.horasSA)}</td>
                            <td className="tnum" style={tdNum}>{brl(r.valorSA)}</td>
                            <td className="tnum" style={tdNum}>{fmtHM(r.horasHE)}</td>
                            <td className="tnum" style={tdNum}>{brl(r.valorHE)}</td>
                            <td className="tnum" style={{ ...tdNum, color: r.valorComp > 0 ? T.danger : T.textMuted }}>{r.valorComp > 0 ? `− ${brl(r.valorComp)}` : brl(0)}</td>
                            <td className="tnum" style={tdNumTotal}>{brl(r.valorTotal)}</td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                {/* Linha de total: mais peso (borda superior de 2px e fundo próprio) —
                    é o número que vai para a folha. */}
                <tr style={{ borderTop: `2px solid ${T.borderStrong}`, background: T.surfaceAlt }}>
                  <td style={{ padding: "0.55rem 0.6rem", fontWeight: 700, color: T.textPrimary }}>Total geral</td>
                  <td className="tnum" style={tdNumTotal}>{fmtHM(grandTotals.horasSA)}</td>
                  <td className="tnum" style={tdNumTotal}>{brl(grandTotals.valorSA)}</td>
                  <td className="tnum" style={tdNumTotal}>{fmtHM(grandTotals.horasHE)}</td>
                  <td className="tnum" style={tdNumTotal}>{brl(grandTotals.valorHE)}</td>
                  <td className="tnum" style={{ ...tdNumTotal, color: grandTotals.valorComp > 0 ? T.danger : T.textPrimary }}>{grandTotals.valorComp > 0 ? `− ${brl(grandTotals.valorComp)}` : brl(0)}</td>
                  <td className="tnum" style={tdNumTotal}>{brl(grandTotals.valorTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* AJUSTES MANUAIS — não persistidos, e a tela diz isso. */}
      <Panel T={T} style={{ padding: "0.85rem" }}>
        <SectionLabel T={T}>Ajustes manuais</SectionLabel>
        <p style={{ fontSize: "0.76rem", color: T.textMuted, margin: "0.35rem 0 0.75rem", lineHeight: 1.55 }}>
          Valores que não vêm de nenhum dado do app (ex.: diferença de reajuste). Somam ao total geral abaixo.
          <b style={{ color: T.warn }}> Não são salvos</b> — anote antes de trocar de mês ou sair da tela.
        </p>

        {adjustments.length > 0 && (
          <div className="mb-3">
            {adjustments.map(j => (
              <div key={j.id} className="flex items-center justify-between gap-2"
                style={{ borderTop: `1px solid ${T.border}`, padding: "0.35rem 0" }}>
                <span style={{ fontSize: "0.82rem", color: T.textPrimary }}>{j.desc}</span>
                <div className="flex items-center gap-2">
                  <span className="tnum" style={{ fontFamily: T.fontMono, fontSize: "0.82rem", fontWeight: 700, color: j.valor < 0 ? T.danger : T.textPrimary }}>{brl(j.valor)}</span>
                  <Button T={T} size="sm" variant="quiet" onClick={() => removeAdjustment(j.id)}
                    aria-label={`Remover ajuste: ${j.desc}`}
                    style={{ width: "2.25rem", minHeight: "2.25rem", padding: 0 }}>
                    <Icon name="x" size={14} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2 items-end">
          <div style={{ flex: "1 1 220px" }}>
            <input value={adjForm.desc} onChange={e => setAdjForm(f => ({ ...f, desc: e.target.value }))}
              placeholder="Descrição (ex.: Diferença de reajuste após 3 meses)" style={{ ...inputStyle, width: "100%" }} />
          </div>
          <div>
            <input type="number" value={adjForm.valor} onChange={e => setAdjForm(f => ({ ...f, valor: e.target.value }))}
              placeholder="Valor (R$)" style={{ ...inputStyle, width: "9rem" }} />
          </div>
          <Button T={T} variant="primary" onClick={addAdjustment}>
            <Icon name="plus" size={13} /> Adicionar
          </Button>
        </div>

        <div className="mt-3 pt-3 flex items-end justify-between flex-wrap gap-3" style={{ borderTop: `1px solid ${T.border}` }}>
          <span style={{ fontSize: "0.8rem", color: T.textMuted }}>
            Total geral: <b className="tnum" style={{ fontFamily: T.fontMono, color: T.textPrimary }}>{brl(grandTotals.valorTotal)}</b>
            {adjustments.length > 0 && <> · Ajustes: <b className="tnum" style={{ fontFamily: T.fontMono, color: T.textPrimary }}>{brl(adjustmentsTotal)}</b></>}
          </span>
          <div className="text-right">
            <div style={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: T.textMuted }}>
              Total geral com ajustes
            </div>
            <div className="tnum" style={{ fontFamily: T.fontMono, fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.01em", color: T.textPrimary, lineHeight: 1.2 }}>
              {brl(grandTotalWithAdjustments)}
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}
