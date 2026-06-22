import { useState, useMemo, useEffect, useCallback } from 'react';
import { useApi } from '../lib/api';
import {
  PEOPLE, MONTHS, durationHours, fmtHM, brl,
  buildSchedule, dayKey, getActiveSub,
} from '../lib/schedule';

const TYPES = ["Hora Extra", "Compensação"];
const TYPE_META = {
  Sobreaviso:   { color: "#60A5FA", bg: "#1E3A5F", lightColor: "#1565C0", lightBg: "#E3F2FD" },
  "Hora Extra": { color: "#F472B6", bg: "#4A1025", lightColor: "#C2185B", lightBg: "#FCE4EC" },
  Compensação:  { color: "#FCD34D", bg: "#431407", lightColor: "#854D0E", lightBg: "#FEF9C3" },
};

// Extrai HH:MM de uma string de turno ex: "23:00 – 04:00"
function parseShiftTime(timeStr) {
  const parts = timeStr.split('–').map(t => t.trim());
  return { inicio: parts[0], fim: parts[1] };
}

export default function ControleDeHoras({ dark, profile }) {
  const api = useApi();
  const now = new Date();

  const [entries,        setEntries]        = useState([]);
  const [paramsByPerson, setParamsByPerson] = useState({});
  const [subs,           setSubs]           = useState([]);
  const [dataLoading,    setDataLoading]    = useState(true);
  const person = profile?.memberId;
  const [monthIdx, setMonthIdx] = useState(now.getMonth());
  const [year,     setYear]     = useState(now.getFullYear());
  const [editId,   setEditId]   = useState(null);

  const blank = { tipo: "Hora Extra", data: "", inicio: "", fim: "", projeto: "", atividade: "" };
  const [form, setForm] = useState(blank);

  // Carrega dados
  useEffect(() => {
    Promise.all([
      api('/api/ch'),
      api('/api/substitutions'),
    ]).then(([chData, subData]) => {
      setEntries(chData.entries || []);
      setParamsByPerson(chData.params || {});
      setSubs(subData || []);
    }).catch(console.error)
      .finally(() => setDataLoading(false));
  }, []);

  const saveEntries = useCallback(async (newEntries) => {
    try { await api('/api/ch', { method: 'POST', body: { entries: newEntries } }); }
    catch (e) { console.error('Erro ao salvar lançamentos:', e); }
  }, [api]);

  const saveParams = useCallback(async (newParams) => {
    try { await api('/api/ch', { method: 'POST', body: { params: newParams } }); }
    catch (e) { console.error('Erro ao salvar parâmetros:', e); }
  }, [api]);

  // ─── TEMA ──────────────────────────────────────────────────────────────────
  const CT = dark ? {
    pageBg:"#0F172A", cardBg:"#1E293B", cardBorder:"#334155",
    text:"#F1F5F9", textLabel:"#64748B", textMuted:"#475569",
    textStrong:"#CBD5E1", textMid:"#94A3B8",
    inputBg:"#0F172A", inputBorder:"#334155",
    divider:"#263347", rowEditBg:"#162032", rowSchedBg:"#0F1E36",
    saveBg:"#F1F5F9", saveColor:"#0F172A",
    cancelBg:"#1E293B", cancelColor:"#94A3B8", cancelBorder:"#334155",
    footerText:"#334155", exportBg:"#166534",
  } : {
    pageBg:"#EEF1F6", cardBg:"#fff", cardBorder:"#E2E8F0",
    text:"#1E293B", textLabel:"#64748B", textMuted:"#94A3B8",
    textStrong:"#374151", textMid:"#4B5563",
    inputBg:"#fff", inputBorder:"#CBD5E1",
    divider:"#F1F5F9", rowEditBg:"#F8FAFC", rowSchedBg:"#EFF6FF",
    saveBg:"#1E293B", saveColor:"#fff",
    cancelBg:"#fff", cancelColor:"#475569", cancelBorder:"#CBD5E1",
    footerText:"#94A3B8", exportBg:"#2E7D32",
  };

  const inputStyle = {
    background: CT.inputBg, color: CT.text,
    border: `1px solid ${CT.inputBorder}`,
    borderRadius: "0.5rem", padding: "0.35rem 0.6rem",
    fontSize: "0.875rem", outline: "none", width: "100%",
    transition: "border-color 0.15s",
  };

  const params = paramsByPerson[person] || { remuneracao: '', jornada: 168 };
  const valorHora = (Number(params.remuneracao) || 0) / params.jornada;

  const setParam = (field, value) => {
    const newParams = { ...paramsByPerson, [person]: { ...params, [field]: value } };
    setParamsByPerson(newParams);
    saveParams(newParams);
  };

  // ─── ENTRADAS DA ESCALA (SA automático) ────────────────────────────────────
  const schedule = useMemo(() => buildSchedule(), []);

  const scheduleEntries = useMemo(() => {
    if (!person) return [];
    return schedule
      .filter(day => day.date.getMonth() === monthIdx && day.date.getFullYear() === year)
      .flatMap(day => {
        const dk = dayKey(day.date);
        return day.shifts
          .filter(shift => {
            const sub = getActiveSub(shift.person, dk, subs);
            const effective = sub ? sub.substituto : shift.person;
            return effective === person;
          })
          .map(shift => {
            const { inicio, fim } = parseShiftTime(shift.time);
            const coveringFor = shift.person !== person ? shift.person : null;
            return {
              id: `sched-${dk}-${shift.period}`,
              person,
              tipo: 'Sobreaviso',
              data: dk,
              inicio,
              fim,
              projeto: '',
              atividade: coveringFor ? `${shift.period} · cobre ${coveringFor}` : shift.period,
              _fromSchedule: true,
            };
          });
      });
  }, [schedule, person, monthIdx, year, subs]);

  // ─── ENTRADAS MANUAIS DO MÊS ───────────────────────────────────────────────
  const manualMonthEntries = useMemo(() => {
    return entries
      .filter(e => {
        if (e.person !== person) return false;
        const d = new Date(e.data + "T12:00:00");
        return d.getMonth() === monthIdx && d.getFullYear() === year;
      })
      .sort((a, b) => (a.data + a.inicio).localeCompare(b.data + b.inicio));
  }, [entries, person, monthIdx, year]);

  // ─── LISTA COMBINADA (SA da escala + HE/Comp manuais) ─────────────────────
  const allMonthEntries = useMemo(() => {
    const combined = [...scheduleEntries, ...manualMonthEntries];
    combined.sort((a, b) => {
      if (a.data !== b.data) return a.data.localeCompare(b.data);
      if (a._fromSchedule && !b._fromSchedule) return -1;
      if (!a._fromSchedule && b._fromSchedule) return 1;
      return (a.inicio || '').localeCompare(b.inicio || '');
    });
    return combined;
  }, [scheduleEntries, manualMonthEntries]);

  // ─── TOTAIS (SA da escala + manuais) ───────────────────────────────────────
  const totals = useMemo(() => {
    let sobreaviso = 0, extra = 0, comp = 0;
    allMonthEntries.forEach(e => {
      const h = durationHours(e.inicio, e.fim);
      if (e.tipo === "Sobreaviso")       sobreaviso += h;
      else if (e.tipo === "Hora Extra")  extra += h;
      else if (e.tipo === "Compensação") comp += h;
    });
    const valorSobreaviso = (valorHora / 3) * sobreaviso;
    const valorExtra = valorHora * 1.5 * extra;
    return { sobreaviso, extra, comp, totalHoras: sobreaviso + extra + comp, valorSobreaviso, valorExtra, valorTotal: valorSobreaviso + valorExtra };
  }, [allMonthEntries, valorHora]);

  // ─── AÇÕES ─────────────────────────────────────────────────────────────────
  const submit = async () => {
    if (!form.data || !form.inicio || !form.fim) return;
    let newEntries;
    if (editId) {
      newEntries = entries.map(e => (e.id === editId ? { ...e, ...form, person } : e));
      setEditId(null);
    } else {
      newEntries = [...entries, { id: crypto.randomUUID(), person, ...form }];
    }
    setEntries(newEntries);
    setForm(blank);
    await saveEntries(newEntries);
  };

  const startEdit = (e) => {
    setForm({ tipo: e.tipo, data: e.data, inicio: e.inicio, fim: e.fim, projeto: e.projeto || "", atividade: e.atividade || "" });
    setEditId(e.id);
  };

  const remove = async (id) => {
    const newEntries = entries.filter(e => e.id !== id);
    setEntries(newEntries);
    if (editId === id) { setEditId(null); setForm(blank); }
    await saveEntries(newEntries);
  };

  const exportCSV = () => {
    const sep = ";";
    const header = ["Data","Tipo","Origem","Início","Fim","Duração (h)","Duração (h:mm)","Projeto","Atividade / Descrição","Responsável"];
    const rows = allMonthEntries.map(e => {
      const h = durationHours(e.inicio, e.fim);
      return [
        e.data, e.tipo,
        e._fromSchedule ? "Escala" : "Manual",
        e.inicio, e.fim,
        h.toFixed(2).replace(".",","), fmtHM(h),
        e.projeto || "",
        (e.atividade || "").replace(/"/g,'""'),
        e.person,
      ];
    });
    const summary = [
      [],
      ["RESUMO", `${MONTHS[monthIdx]} ${year}`, person],
      ["Remuneração mensal", brl(Number(params.remuneracao) || 0)],
      ["Jornada (h)", String(params.jornada)],
      ["Valor hora", brl(valorHora)],
      ["Horas sobreaviso (escala)", fmtHM(totals.sobreaviso)],
      ["Horas extra", fmtHM(totals.extra)],
      ["Horas compensação", fmtHM(totals.comp)],
      ["Valor sobreaviso (÷3)", brl(totals.valorSobreaviso)],
      ["Valor hora extra (×1,5)", brl(totals.valorExtra)],
      ["VALOR TOTAL", brl(totals.valorTotal)],
    ];
    const csv = "﻿" + [[header], rows, summary].flat().map(r => r.map(c => `"${String(c)}"`).join(sep)).join("\r\n");
    const blob = new Blob([csv], { type:"text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `controle-horas_${person.replace(/\s/g,"-")}_${MONTHS[monthIdx]}-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const p = PEOPLE[person] || { color: "#64748B", bg: "#F1F5F9" };
  const years = [year - 1, year, year + 1];
  const liveDuration = durationHours(form.inicio, form.fim);
  const canSubmit = !!(form.data && form.inicio && form.fim);

  return (
    <div style={{ minHeight:"100vh", background:CT.pageBg, fontFamily:"'Segoe UI',system-ui,sans-serif", color:CT.text, transition:"background 0.2s,color 0.2s" }}>
      <div className="max-w-3xl mx-auto px-4 py-6">

        {/* CABEÇALHO */}
        <div className="rounded-2xl p-5 mb-5 text-white" style={{ background:"linear-gradient(135deg,#1E293B 0%,#334155 100%)" }}>
          <div className="text-xs uppercase tracking-widest opacity-60 mb-1">Controle de Horas</div>
          <div className="text-2xl font-bold">{MONTHS[monthIdx]} de {year}</div>
          <div className="text-sm opacity-70 mt-1">Sobreaviso (escala automática) + horas extra e compensação</div>
        </div>

        {dataLoading && (
          <div className="rounded-2xl p-4 mb-4 text-center text-sm" style={{ background:CT.cardBg, border:`1px solid ${CT.cardBorder}`, color:CT.textMuted }}>
            Carregando dados...
          </div>
        )}

        {/* SELETORES */}
        <div className="flex flex-wrap gap-3 mb-4 items-end">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color:CT.textLabel }}>Responsável</div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-bold"
              style={{ background: p.color, color: "#fff" }}>
              <span className="w-2 h-2 rounded-full bg-white opacity-70" />
              {person}
            </div>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color:CT.textLabel }}>Mês</div>
            <select style={inputStyle} value={monthIdx} onChange={e => setMonthIdx(Number(e.target.value))}>
              {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color:CT.textLabel }}>Ano</div>
            <select style={{ ...inputStyle, width:"auto" }} value={year} onChange={e => setYear(Number(e.target.value))}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        {/* PARÂMETROS */}
        <div className="rounded-2xl p-4 mb-4" style={{ background:CT.cardBg, border:`1px solid ${CT.cardBorder}` }}>
          <div className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color:CT.textLabel }}>Parâmetros de {person}</div>
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <div className="text-xs mb-1" style={{ color:CT.textLabel }}>Remuneração mensal (R$)</div>
              <input type="number" style={{ ...inputStyle, width:"9rem" }} value={params.remuneracao} placeholder="0,00"
                onChange={e => setParam("remuneracao", e.target.value === '' ? '' : Number(e.target.value))} />
            </div>
            <div>
              <div className="text-xs mb-1" style={{ color:CT.textLabel }}>Jornada (h)</div>
              <input type="number" style={{ ...inputStyle, width:"6rem" }} value={params.jornada}
                onChange={e => setParam("jornada", Number(e.target.value))} />
            </div>
            <div className="ml-auto text-right">
              <div className="text-xs" style={{ color:CT.textLabel }}>Valor hora</div>
              <div className="text-lg font-bold" style={{ color:p.color }}>{valorHora > 0 ? brl(valorHora) : "—"}</div>
            </div>
          </div>
        </div>

        {/* FORMULÁRIO — só HE e Compensação */}
        <div className="rounded-2xl p-4 mb-4" style={{ background:CT.cardBg, border:`1px solid ${CT.cardBorder}` }}>
          <div className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color:CT.textLabel }}>
            {editId ? "Editar lançamento" : "Novo lançamento (HE ou Compensação)"}
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3" style={{ gridTemplateColumns:"repeat(auto-fit, minmax(120px, 1fr))" }}>
            <div>
              <div className="text-xs mb-1" style={{ color:CT.textLabel }}>Tipo</div>
              <select style={inputStyle} value={form.tipo} onChange={e => setForm({ ...form, tipo:e.target.value })}>
                {TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <div className="text-xs mb-1" style={{ color:CT.textLabel }}>Data</div>
              <input type="date" style={inputStyle} value={form.data} onChange={e => setForm({ ...form, data:e.target.value })} />
            </div>
            <div>
              <div className="text-xs mb-1" style={{ color:CT.textLabel }}>Início</div>
              <input type="time" style={inputStyle} value={form.inicio} onChange={e => setForm({ ...form, inicio:e.target.value })} />
            </div>
            <div>
              <div className="text-xs mb-1" style={{ color:CT.textLabel }}>Fim</div>
              <input type="time" style={inputStyle} value={form.fim} onChange={e => setForm({ ...form, fim:e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 mb-3" style={{ gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))" }}>
            <div>
              <div className="text-xs mb-1" style={{ color:CT.textLabel }}>Projeto</div>
              <input type="text" style={inputStyle} placeholder="Ex.: CorpX, AICE…" value={form.projeto} onChange={e => setForm({ ...form, projeto:e.target.value })} />
            </div>
            <div>
              <div className="text-xs mb-1" style={{ color:CT.textLabel }}>Atividade / Descrição</div>
              <input type="text" style={inputStyle} placeholder="O que foi feito" value={form.atividade} onChange={e => setForm({ ...form, atividade:e.target.value })} />
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={submit}
              style={{ background:canSubmit?CT.saveBg:CT.cardBorder, color:canSubmit?CT.saveColor:CT.textMuted, border:"none", borderRadius:"0.5rem", padding:"0.45rem 1.1rem", fontWeight:"700", fontSize:"0.875rem", cursor:canSubmit?"pointer":"not-allowed", transition:"background 0.15s" }}>
              {editId ? "Salvar alterações" : "Adicionar lançamento"}
            </button>
            {editId && (
              <button onClick={() => { setEditId(null); setForm(blank); }}
                style={{ background:CT.cancelBg, color:CT.cancelColor, border:`1px solid ${CT.cancelBorder}`, borderRadius:"0.5rem", padding:"0.45rem 1.1rem", fontWeight:"700", fontSize:"0.875rem", cursor:"pointer" }}>
                Cancelar
              </button>
            )}
            {form.inicio && form.fim && (
              <span className="text-sm" style={{ color:CT.textLabel }}>
                Duração: <b style={{ color:CT.text }}>{fmtHM(liveDuration)}</b>
              </span>
            )}
          </div>
        </div>

        {/* RELATÓRIO */}
        <div className="rounded-2xl p-4 mb-4" style={{ background:CT.cardBg, border:`1px solid ${CT.cardBorder}` }}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-bold uppercase tracking-wider" style={{ color:CT.textLabel }}>Relatório do mês</div>
            <button onClick={exportCSV} disabled={allMonthEntries.length === 0}
              style={{ background:allMonthEntries.length>0?CT.exportBg:CT.cardBorder, color:allMonthEntries.length>0?"#fff":CT.textMuted, border:"none", borderRadius:"0.5rem", padding:"0.35rem 0.9rem", fontWeight:"700", fontSize:"0.875rem", cursor:allMonthEntries.length>0?"pointer":"not-allowed" }}>
              ↓ Exportar CSV
            </button>
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))" }}>
            {[
              { label:"Sobreaviso",  h:totals.sobreaviso, v:totals.valorSobreaviso, tm:TYPE_META.Sobreaviso },
              { label:"Hora Extra",  h:totals.extra,      v:totals.valorExtra,      tm:TYPE_META["Hora Extra"] },
              { label:"Compensação", h:totals.comp,       v:null,                   tm:TYPE_META.Compensação },
            ].map(b => {
              const bg    = dark ? b.tm.bg    : b.tm.lightBg;
              const color = dark ? b.tm.color : b.tm.lightColor;
              return (
                <div key={b.label} className="rounded-xl p-3" style={{ background:bg }}>
                  <div className="text-xs font-bold uppercase tracking-wide" style={{ color }}>{b.label}</div>
                  <div className="text-xl font-bold" style={{ color:dark?"#F1F5F9":"#1E293B" }}>{fmtHM(b.h)}</div>
                  {b.v !== null && valorHora > 0 && <div className="text-sm font-semibold" style={{ color }}>{brl(b.v)}</div>}
                </div>
              );
            })}
          </div>
          <div className="mt-3 pt-3 flex items-center justify-between" style={{ borderTop:`1px solid ${CT.cardBorder}` }}>
            <span className="text-sm" style={{ color:CT.textLabel }}>Total de horas: <b style={{ color:CT.text }}>{fmtHM(totals.totalHoras)}</b></span>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide" style={{ color:CT.textLabel }}>Valor total a receber</div>
              <div className="text-2xl font-bold" style={{ color:p.color }}>
                {valorHora > 0 ? brl(totals.valorTotal) : "—"}
              </div>
            </div>
          </div>
        </div>

        {/* TABELA */}
        <div className="rounded-2xl overflow-hidden" style={{ border:`1px solid ${CT.cardBorder}` }}>
          <div className="px-4 py-3 flex items-center justify-between" style={{ background:CT.cardBg, borderBottom:`1px solid ${CT.cardBorder}` }}>
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color:CT.textLabel }}>
              Lançamentos ({allMonthEntries.length})
            </span>
            <div className="flex items-center gap-3 text-[10px]" style={{ color:CT.textMuted }}>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-sm" style={{ background: dark ? "#1E3A5F" : "#DBEAFE" }} />
                SA · escala automática
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-sm" style={{ background: dark ? "#4A1025" : "#FCE7F3" }} />
                HE · manual
              </span>
            </div>
          </div>

          {allMonthEntries.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm" style={{ color:CT.textMuted, background:CT.cardBg }}>
              {dataLoading ? "Carregando..." : "Nenhum lançamento neste mês."}
            </div>
          ) : (
            <div style={{ background:CT.cardBg }}>
              {allMonthEntries.map((e, i) => {
                const h = durationHours(e.inicio, e.fim);
                const tm = TYPE_META[e.tipo];
                const tagBg    = dark ? tm.bg    : tm.lightBg;
                const tagColor = dark ? tm.color : tm.lightColor;
                const rowBg = e._fromSchedule
                  ? CT.rowSchedBg
                  : editId === e.id ? CT.rowEditBg : "transparent";

                return (
                  <div key={e.id} className="px-4 py-2.5 flex items-center gap-3 text-sm"
                    style={{ borderTop:i>0?`1px solid ${CT.divider}`:"none", background:rowBg }}>
                    <div className="font-mono font-bold w-14 shrink-0" style={{ color:CT.textStrong }}>
                      {e.data.slice(8,10)}/{e.data.slice(5,7)}
                    </div>
                    <span className="rounded-md px-2 py-0.5 text-xs font-bold shrink-0" style={{ background:tagBg, color:tagColor }}>
                      {e._fromSchedule ? "SA" : e.tipo === "Hora Extra" ? "HE" : "Comp"}
                    </span>
                    <span className="font-mono text-xs shrink-0 w-24" style={{ color:CT.textLabel }}>{e.inicio}–{e.fim}</span>
                    <span className="font-mono text-xs font-bold shrink-0 w-12" style={{ color:CT.textStrong }}>{fmtHM(h)}</span>
                    <span className="flex-1 truncate" style={{ color:CT.textMid }}>
                      {e.projeto && <b style={{ color:CT.textStrong }}>{e.projeto}: </b>}{e.atividade}
                    </span>
                    {!e._fromSchedule && <>
                      <button onClick={() => startEdit(e)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:"0.75rem", color:CT.textLabel, flexShrink:0 }}>editar</button>
                      <button onClick={() => remove(e.id)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:"0.75rem", color:"#F87171", flexShrink:0 }}>excluir</button>
                    </>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-6 text-center text-xs" style={{ color:CT.footerText }}>
          SA preenchido automaticamente pela escala · HE e compensação lançados manualmente · Dados salvos na nuvem
        </div>
      </div>
    </div>
  );
}
