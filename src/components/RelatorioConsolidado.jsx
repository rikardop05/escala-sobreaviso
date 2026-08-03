import { useState, useEffect, useMemo, Fragment } from 'react';
import { useApi } from '../lib/api';
import { MONTHS, fmtHM, brl, buildSchedule } from '../lib/schedule';
import { scheduleEntriesFor, monthTotals } from '../lib/chCalc';
import { TEAMS, MEMBERS, chGroupsFor } from '../lib/teams';
import { getTheme, DANGER, WARN } from '../lib/theme';
import { Icon, friendlyError } from './ui';

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
          const manualEntries = (chData.entries || []).filter(e => {
            if (e.person !== person) return false;
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

  const inputStyle = {
    background: T.inputBg, color: T.textPrimary,
    border: `1px solid ${T.inputBorder}`,
    borderRadius: "0.5rem", padding: "0.5rem 0.6rem", minHeight: "2.5rem",
    fontSize: "0.875rem",
  };
  const thStyle = { textAlign: "right", fontSize: "0.68rem", fontWeight: 600, color: T.labelColor, padding: "0.5rem 0.6rem", whiteSpace: "nowrap" };
  const thStyleLeft = { ...thStyle, textAlign: "left" };
  const tdNum = { textAlign: "right", padding: "0.45rem 0.6rem", whiteSpace: "nowrap", fontFamily: "monospace" };

  return (
    <div>
      {/* NOTA DE FÓRMULA — fixa, não removível (insumo de pagamento, precisa estar sempre visível) */}
      <div role="note" className="rounded-2xl p-4 mb-4 flex items-start gap-2.5" style={{ background: dark ? "rgba(245,158,11,0.1)" : "#FEF9C3", border: `1px solid ${WARN}` }}>
        <Icon name="alert" size={16} style={{ color: WARN, flexShrink: 0, marginTop: '0.1rem' }} />
        <div className="text-sm" style={{ color: T.textPrimary }}>
          <b>{FORMULA_NOTE}</b>
          <div className="text-xs mt-1" style={{ color: T.textSecondary }}>{FORMULA_NOTE_2}</div>
        </div>
      </div>

      {error && (
        <p role="alert" className="flex items-center gap-1.5 text-sm font-semibold mb-3" style={{ color: DANGER }}>
          <Icon name="alert" size={14} /> {error}
        </p>
      )}

      {loading ? (
        <div role="status" className="rounded-2xl p-6 mb-4 text-center text-sm" style={{ background: T.cardBg, border: `1px solid ${T.cardBorder}`, color: T.textMuted }}>
          Carregando o relatório de {MONTHS[monthIdx]} de {year}…
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-2xl p-6 mb-4 text-center text-sm" style={{ background: T.cardBg, border: `1px solid ${T.cardBorder}`, color: T.textMuted }}>
          Você não administra nenhuma equipe.
        </div>
      ) : (
        <section className="rounded-2xl overflow-hidden mb-4" style={{ border: `1px solid ${T.cardBorder}` }}>
          <div className="px-4 py-3 flex items-center justify-between flex-wrap gap-2" style={{ background: T.cardBg, borderBottom: `1px solid ${T.cardBorder}` }}>
            <h2 className="text-sm font-semibold" style={{ color: T.textSecondary }}>
              {MONTHS[monthIdx]} de {year} · {rows.length} pessoa{rows.length !== 1 ? "s" : ""}
            </h2>
            <button onClick={exportCSV} disabled={rows.length === 0}
              className="inline-flex items-center gap-2"
              style={{ background: rows.length > 0 ? T.exportBg : T.cardBorder, color: rows.length > 0 ? "#fff" : T.textMuted, border: "none", borderRadius: "0.5rem", padding: "0.5rem 0.9rem", minHeight: "2.75rem", fontWeight: "700", fontSize: "0.8rem", cursor: rows.length > 0 ? "pointer" : "not-allowed" }}>
              <Icon name="download" size={14} /> Exportar CSV
            </button>
          </div>

          <div style={{ background: T.cardBg, overflowX: "auto" }}>
            <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: "760px" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.divider}` }}>
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
                      <tr style={{ background: dark ? "rgba(148,163,184,0.08)" : "#F1F5F9" }}>
                        <td colSpan={7} style={{ padding: "0.4rem 0.6rem", fontSize: "0.72rem", fontWeight: 700, color: T.labelColor, letterSpacing: "0.02em", textTransform: "uppercase" }}>
                          {g.nome}
                        </td>
                      </tr>
                      {teamRows.map(r => {
                        const fullName = MEMBERS[r.person]?.fullName || r.person;
                        return (
                          <tr key={r.person} style={{ borderTop: `1px solid ${T.divider}` }}>
                            <td style={{ padding: "0.45rem 0.6rem" }}>
                              <span style={{ color: T.textPrimary, fontWeight: 600 }}>{fullName}</span>
                              {r.closed && (
                                <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-bold rounded-full px-2 py-0.5" style={{ background: "rgba(34,197,94,0.15)", color: "#22C55E" }}>
                                  <Icon name="check" size={10} /> mês fechado
                                </span>
                              )}
                            </td>
                            <td style={tdNum}>{fmtHM(r.horasSA)}</td>
                            <td style={tdNum}>{brl(r.valorSA)}</td>
                            <td style={tdNum}>{fmtHM(r.horasHE)}</td>
                            <td style={tdNum}>{brl(r.valorHE)}</td>
                            <td style={{ ...tdNum, color: r.valorComp > 0 ? DANGER : T.textPrimary }}>{r.valorComp > 0 ? `− ${brl(r.valorComp)}` : brl(0)}</td>
                            <td style={{ ...tdNum, fontWeight: 700, color: T.textPrimary }}>{brl(r.valorTotal)}</td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: `2px solid ${T.cardBorder}`, background: dark ? "rgba(148,163,184,0.06)" : "#F8FAFC" }}>
                  <td style={{ padding: "0.55rem 0.6rem", fontWeight: 700, color: T.textPrimary }}>Total geral</td>
                  <td style={{ ...tdNum, fontWeight: 700 }}>{fmtHM(grandTotals.horasSA)}</td>
                  <td style={{ ...tdNum, fontWeight: 700 }}>{brl(grandTotals.valorSA)}</td>
                  <td style={{ ...tdNum, fontWeight: 700 }}>{fmtHM(grandTotals.horasHE)}</td>
                  <td style={{ ...tdNum, fontWeight: 700 }}>{brl(grandTotals.valorHE)}</td>
                  <td style={{ ...tdNum, fontWeight: 700, color: grandTotals.valorComp > 0 ? DANGER : T.textPrimary }}>{grandTotals.valorComp > 0 ? `− ${brl(grandTotals.valorComp)}` : brl(0)}</td>
                  <td style={{ ...tdNum, fontWeight: 700, color: T.textPrimary }}>{brl(grandTotals.valorTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      {/* AJUSTES MANUAIS */}
      <section className="rounded-2xl p-4" style={{ background: T.cardBg, border: `1px solid ${T.cardBorder}` }}>
        <h2 className="text-sm font-semibold mb-1" style={{ color: T.textSecondary }}>Ajustes manuais</h2>
        <p className="text-xs mb-3" style={{ color: T.textMuted }}>
          Valores que não vêm de nenhum dado do app (ex.: diferença de reajuste). Somam ao total geral abaixo.
          <b> Não são salvos</b> — anote antes de trocar de mês ou sair da tela.
        </p>

        {adjustments.length > 0 && (
          <div className="mb-3">
            {adjustments.map(j => (
              <div key={j.id} className="flex items-center justify-between py-1.5" style={{ borderTop: `1px solid ${T.divider}` }}>
                <span className="text-sm" style={{ color: T.textPrimary }}>{j.desc}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono font-bold" style={{ color: j.valor < 0 ? DANGER : T.textPrimary }}>{brl(j.valor)}</span>
                  <button onClick={() => removeAdjustment(j.id)} aria-label={`Remover ajuste: ${j.desc}`}
                    style={{ background: "none", border: "none", cursor: "pointer", color: T.textMuted, display: "inline-flex", alignItems: "center", justifyContent: "center", width: "2.25rem", height: "2.25rem", borderRadius: "0.4rem" }}>
                    <Icon name="x" size={13} />
                  </button>
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
          <button type="button" onClick={addAdjustment}
            className="inline-flex items-center gap-1.5"
            style={{ background: T.saveBg, color: T.saveColor, border: "none", borderRadius: "0.5rem", padding: "0.5rem 0.9rem", minHeight: "2.5rem", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer" }}>
            <Icon name="plus" size={13} /> Adicionar
          </button>
        </div>

        <div className="mt-3 pt-3 flex items-center justify-between flex-wrap gap-2" style={{ borderTop: `1px solid ${T.cardBorder}` }}>
          <span className="text-sm" style={{ color: T.labelColor }}>
            Total geral: <b style={{ color: T.textPrimary }}>{brl(grandTotals.valorTotal)}</b>
            {adjustments.length > 0 && <> · Ajustes: <b style={{ color: T.textPrimary }}>{brl(adjustmentsTotal)}</b></>}
          </span>
          <div className="text-right">
            <div className="text-xs" style={{ color: T.labelColor }}>Total geral com ajustes</div>
            <div className="text-2xl font-bold" style={{ color: T.textPrimary }}>{brl(grandTotalWithAdjustments)}</div>
          </div>
        </div>
      </section>
    </div>
  );
}
