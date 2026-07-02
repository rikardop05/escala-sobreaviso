import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useApi } from '../lib/api';
import {
  PEOPLE, CH_NAMES, MONTHS, durationHours, fmtHM, brl,
  buildSchedule, dayKey, getActiveSub,
} from '../lib/schedule';
import { getTheme, DANGER, WARN } from '../lib/theme';
import { Icon, SaveStatus, Snackbar, friendlyError } from './ui';

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
  const isAdmin = profile?.role === 'admin';

  const [entries,        setEntries]        = useState([]);
  const [paramsByPerson, setParamsByPerson] = useState({});
  const [subs,           setSubs]           = useState([]);
  const [overrides,      setOverrides]      = useState({});
  const [dataLoading,    setDataLoading]    = useState(true);

  // Status de persistência — o usuário sempre vê se o dado chegou ao servidor
  const [entriesStatus, setEntriesStatus] = useState('idle'); // idle | saving | saved | error
  const [paramsStatus,  setParamsStatus]  = useState('idle');
  const pendingEntries = useRef(null); // { newEntries } aguardando retry após falha
  const pendingParams  = useRef(null); // { newParams } aguardando retry após falha
  const entriesTimer   = useRef(null);
  const paramsTimer    = useRef(null);
  const paramsDebounce = useRef(null);

  const [undoEntry, setUndoEntry] = useState(null); // lançamento recém-excluído, restaurável
  const undoTimer = useRef(null);

  // Admin can switch to view any CH_NAMES member; member is locked to their own
  const [viewPerson, setViewPerson] = useState(profile?.memberId ?? null);
  const person = isAdmin ? (viewPerson ?? profile?.memberId) : profile?.memberId;

  const [monthIdx, setMonthIdx] = useState(now.getMonth());
  const [year,     setYear]     = useState(now.getFullYear());
  const [editId,   setEditId]   = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const blank = { tipo: "Hora Extra", data: "", inicio: "", fim: "", projeto: "", atividade: "" };
  const [form, setForm] = useState(blank);

  // Reload CH data when admin switches person
  useEffect(() => {
    setDataLoading(true);
    const query = isAdmin && person ? `?person=${encodeURIComponent(person)}` : '';
    Promise.all([
      api(`/api/ch${query}`),
      api('/api/substitutions'),
      api('/api/schedule'),
    ]).then(([chData, subData, overridesData]) => {
      setEntries(chData.entries || []);
      setParamsByPerson(chData.params || {});
      setSubs(subData || []);
      setOverrides(overridesData || {});
    }).catch(console.error)
      .finally(() => setDataLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person]);

  useEffect(() => () => {
    clearTimeout(entriesTimer.current);
    clearTimeout(paramsTimer.current);
    clearTimeout(paramsDebounce.current);
    clearTimeout(undoTimer.current);
  }, []);

  const flashSaved = (setStatus, timerRef) => {
    setStatus('saved');
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setStatus('idle'), 2500);
  };

  // Persiste lançamentos com rollback: em falha, a UI volta ao estado anterior
  // e o chip de erro oferece "Tentar de novo".
  const persistEntries = useCallback(async (newEntries, prevEntries) => {
    setEntriesStatus('saving');
    try {
      const body = { entries: newEntries };
      if (isAdmin && person !== profile?.memberId) body.person = person;
      await api('/api/ch', { method: 'POST', body });
      pendingEntries.current = null;
      flashSaved(setEntriesStatus, entriesTimer);
      return true;
    } catch (e) {
      console.error('Erro ao salvar lançamentos:', e);
      if (prevEntries) setEntries(prevEntries);
      pendingEntries.current = { newEntries };
      setEntriesStatus('error');
      return false;
    }
  }, [api, isAdmin, person, profile?.memberId]);

  const retryEntries = () => {
    const pending = pendingEntries.current;
    if (!pending) return;
    setEntries(pending.newEntries);
    persistEntries(pending.newEntries, entries);
  };

  const persistParams = useCallback(async (newParams) => {
    setParamsStatus('saving');
    try {
      const body = { params: newParams };
      if (isAdmin && person !== profile?.memberId) body.person = person;
      await api('/api/ch', { method: 'POST', body });
      pendingParams.current = null;
      flashSaved(setParamsStatus, paramsTimer);
    } catch (e) {
      console.error('Erro ao salvar parâmetros:', e);
      pendingParams.current = { newParams };
      setParamsStatus('error');
    }
  }, [api, isAdmin, person, profile?.memberId]);

  const retryParams = () => {
    const pending = pendingParams.current;
    if (pending) persistParams(pending.newParams);
  };

  const T = getTheme(dark);

  const inputStyle = {
    background: T.inputBg, color: T.textPrimary,
    border: `1px solid ${T.inputBorder}`,
    borderRadius: "0.5rem", padding: "0.5rem 0.6rem", minHeight: "2.5rem",
    fontSize: "0.875rem", width: "100%",
    transition: "border-color 0.15s",
  };
  const labelStyle = { fontSize: "0.72rem", fontWeight: 600, color: T.labelColor, display: "block", marginBottom: "0.25rem" };

  const params = paramsByPerson[person] || { remuneracao: '', jornada: 168 };
  const valorHora = (Number(params.remuneracao) || 0) / params.jornada;

  // Atualiza na hora, persiste com debounce — evita um POST por tecla digitada
  const setParam = (field, value) => {
    const newParams = { ...paramsByPerson, [person]: { ...params, [field]: value } };
    setParamsByPerson(newParams);
    clearTimeout(paramsDebounce.current);
    paramsDebounce.current = setTimeout(() => persistParams(newParams), 600);
  };

  // ─── ENTRADAS DA ESCALA (SA automático, com overrides) ─────────────────────
  const schedule = useMemo(() => buildSchedule(overrides), [overrides]);

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
    if (!form.data || !form.inicio || !form.fim || submitting) return;
    setSubmitting(true);
    const prevEntries = entries;
    const prevForm = form;
    const prevEditId = editId;
    let newEntries;
    if (editId) {
      newEntries = entries.map(e => (e.id === editId ? { ...e, ...form, person } : e));
      setEditId(null);
    } else {
      newEntries = [...entries, { id: crypto.randomUUID(), person, ...form }];
    }
    setEntries(newEntries);
    setForm(blank);
    const ok = await persistEntries(newEntries, prevEntries);
    if (!ok) {
      // Falhou: devolve o formulário preenchido para o usuário não perder o que digitou
      setForm(prevForm);
      setEditId(prevEditId);
    }
    setSubmitting(false);
  };

  const startEdit = (e) => {
    setForm({ tipo: e.tipo, data: e.data, inicio: e.inicio, fim: e.fim, projeto: e.projeto || "", atividade: e.atividade || "" });
    setEditId(e.id);
  };

  // Exclusão otimista com undo de 5s — mais seguro que um confirm para valores financeiros
  const remove = async (entry) => {
    const prevEntries = entries;
    const newEntries = entries.filter(e => e.id !== entry.id);
    setEntries(newEntries);
    if (editId === entry.id) { setEditId(null); setForm(blank); }
    clearTimeout(undoTimer.current);
    setUndoEntry(entry);
    undoTimer.current = setTimeout(() => setUndoEntry(null), 6000);
    const ok = await persistEntries(newEntries, prevEntries);
    if (!ok) {
      clearTimeout(undoTimer.current);
      setUndoEntry(null);
    }
  };

  const undoRemove = async () => {
    if (!undoEntry) return;
    const entry = undoEntry;
    clearTimeout(undoTimer.current);
    setUndoEntry(null);
    const prevEntries = entries;
    const newEntries = [...entries, entry];
    setEntries(newEntries);
    await persistEntries(newEntries, prevEntries);
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
  const crossesMidnight = form.inicio && form.fim && form.fim <= form.inicio;
  const canSubmit = !!(form.data && form.inicio && form.fim) && !submitting;

  const thStyle = { textAlign: "left", fontSize: "0.68rem", fontWeight: 600, color: T.labelColor, padding: "0.5rem 0.5rem", whiteSpace: "nowrap" };

  return (
    <div style={{ minHeight:"100vh", background:T.pageBg, fontFamily:"'Segoe UI',system-ui,sans-serif", color:T.textPrimary, transition:"background 0.2s,color 0.2s" }}>
      <div className="max-w-3xl mx-auto px-4 py-6">

        {/* CABEÇALHO */}
        <header className="rounded-2xl p-5 mb-5 text-white" style={{ background:T.headerGrad }}>
          <h1 className="text-sm font-semibold opacity-80 mb-1" style={{ letterSpacing:"0.01em" }}>Controle de Horas</h1>
          <div className="text-2xl font-bold">{MONTHS[monthIdx]} de {year}</div>
          <div className="text-sm opacity-80 mt-1">Sobreaviso (escala automática) + horas extra e compensação</div>
        </header>

        {dataLoading && (
          <div role="status" className="rounded-2xl p-4 mb-4 text-center text-sm" style={{ background:T.cardBg, border:`1px solid ${T.cardBorder}`, color:T.textMuted }}>
            Carregando lançamentos e parâmetros…
          </div>
        )}

        {/* SELETORES */}
        <div className="flex flex-wrap gap-3 mb-4 items-end">
          <div>
            <label style={labelStyle} htmlFor="ch-person">Responsável</label>
            {isAdmin ? (
              <select id="ch-person" style={{ ...inputStyle, width:'auto' }} value={viewPerson || ''} onChange={e => { setViewPerson(e.target.value); setEditId(null); setForm(blank); }}>
                {CH_NAMES.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            ) : (
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-bold"
                style={{ background: p.color, color: "#fff", minHeight:"2.5rem" }}>
                <span className="w-2 h-2 rounded-full bg-white opacity-70" />
                {person}
              </div>
            )}
          </div>
          <div>
            <label style={labelStyle} htmlFor="ch-month">Mês</label>
            <select id="ch-month" style={inputStyle} value={monthIdx} onChange={e => setMonthIdx(Number(e.target.value))}>
              {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle} htmlFor="ch-year">Ano</label>
            <select id="ch-year" style={{ ...inputStyle, width:"auto" }} value={year} onChange={e => setYear(Number(e.target.value))}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        {/* PARÂMETROS */}
        <section className="rounded-2xl p-4 mb-4" style={{ background:T.cardBg, border:`1px solid ${T.cardBorder}` }}>
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <h2 className="text-sm font-semibold" style={{ color:T.textSecondary }}>Parâmetros de {person}</h2>
            <SaveStatus status={paramsStatus} onRetry={retryParams} T={T} />
          </div>
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label style={labelStyle} htmlFor="ch-remun">Remuneração mensal (R$)</label>
              <input id="ch-remun" type="number" style={{ ...inputStyle, width:"9rem" }} value={params.remuneracao} placeholder="0,00"
                onChange={e => setParam("remuneracao", e.target.value === '' ? '' : Number(e.target.value))} />
            </div>
            <div>
              <label style={labelStyle} htmlFor="ch-jornada">Jornada (h)</label>
              <input id="ch-jornada" type="number" style={{ ...inputStyle, width:"6rem" }} value={params.jornada}
                onChange={e => setParam("jornada", Number(e.target.value))} />
            </div>
            <div className="ml-auto text-right">
              <div className="text-xs" style={{ color:T.labelColor }}>Valor hora <span style={{ color:T.textMuted }}>(remuneração ÷ jornada)</span></div>
              <div className="text-lg font-bold" style={{ color:p.color }}>{valorHora > 0 ? brl(valorHora) : "—"}</div>
            </div>
          </div>
        </section>

        {/* FORMULÁRIO — só HE e Compensação */}
        <section className="rounded-2xl p-4 mb-4" style={{ background:T.cardBg, border:`1px solid ${T.cardBorder}` }}>
          <h2 className="text-sm font-semibold mb-3" style={{ color:T.textSecondary }}>
            {editId ? `Editar lançamento — ${person}` : `Novo lançamento (HE ou Compensação) — ${person}`}
          </h2>
          <div className="grid grid-cols-2 gap-3 mb-3" style={{ gridTemplateColumns:"repeat(auto-fit, minmax(120px, 1fr))" }}>
            <div>
              <label style={labelStyle} htmlFor="ch-tipo">Tipo</label>
              <select id="ch-tipo" style={inputStyle} value={form.tipo} onChange={e => setForm({ ...form, tipo:e.target.value })}>
                {TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle} htmlFor="ch-data">Data</label>
              <input id="ch-data" type="date" style={inputStyle} value={form.data} onChange={e => setForm({ ...form, data:e.target.value })} />
            </div>
            <div>
              <label style={labelStyle} htmlFor="ch-inicio">Início</label>
              <input id="ch-inicio" type="time" style={inputStyle} value={form.inicio} onChange={e => setForm({ ...form, inicio:e.target.value })} />
            </div>
            <div>
              <label style={labelStyle} htmlFor="ch-fim">Fim</label>
              <input id="ch-fim" type="time" style={inputStyle} value={form.fim} onChange={e => setForm({ ...form, fim:e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 mb-3" style={{ gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))" }}>
            <div>
              <label style={labelStyle} htmlFor="ch-projeto">Projeto</label>
              <input id="ch-projeto" type="text" style={inputStyle} placeholder="Ex.: CorpX, AICE…" value={form.projeto} onChange={e => setForm({ ...form, projeto:e.target.value })} />
            </div>
            <div>
              <label style={labelStyle} htmlFor="ch-atividade">Atividade / Descrição</label>
              <input id="ch-atividade" type="text" style={inputStyle} placeholder="O que foi feito" value={form.atividade} onChange={e => setForm({ ...form, atividade:e.target.value })} />
            </div>
          </div>
          {crossesMidnight && (
            <p className="flex items-center gap-1.5 text-xs font-semibold mb-3" style={{ color:WARN }}>
              <Icon name="alert" size={13} />
              Fim antes do início: será registrado como turno que atravessa a meia-noite ({fmtHM(liveDuration)} de duração). Confira antes de salvar.
            </p>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={submit} disabled={!canSubmit}
              style={{ background:canSubmit?T.saveBg:T.cardBorder, color:canSubmit?T.saveColor:T.textMuted, border:"none", borderRadius:"0.5rem", padding:"0.5rem 1.1rem", minHeight:"2.75rem", fontWeight:"700", fontSize:"0.875rem", cursor:canSubmit?"pointer":"not-allowed", transition:"background 0.15s" }}>
              {submitting ? "Salvando…" : editId ? "Salvar alterações" : "Adicionar lançamento"}
            </button>
            {editId && (
              <button onClick={() => { setEditId(null); setForm(blank); }}
                style={{ background:T.cancelBg, color:T.cancelColor, border:`1px solid ${T.cancelBorder}`, borderRadius:"0.5rem", padding:"0.5rem 1.1rem", minHeight:"2.75rem", fontWeight:"700", fontSize:"0.875rem", cursor:"pointer" }}>
                Cancelar
              </button>
            )}
            {form.inicio && form.fim && (
              <span className="text-sm" style={{ color:T.labelColor }}>
                Duração: <b style={{ color:T.textPrimary }}>{fmtHM(liveDuration)}</b>
              </span>
            )}
            <SaveStatus status={entriesStatus} onRetry={retryEntries} T={T} />
          </div>
        </section>

        {/* RELATÓRIO */}
        <section className="rounded-2xl p-4 mb-4" style={{ background:T.cardBg, border:`1px solid ${T.cardBorder}` }}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold" style={{ color:T.textSecondary }}>Relatório do mês</h2>
            <button onClick={exportCSV} disabled={allMonthEntries.length === 0}
              style={{ display:"inline-flex", alignItems:"center", gap:"0.4rem", background:allMonthEntries.length>0?T.exportBg:T.cardBorder, color:allMonthEntries.length>0?"#fff":T.textMuted, border:"none", borderRadius:"0.5rem", padding:"0.5rem 0.9rem", minHeight:"2.75rem", fontWeight:"700", fontSize:"0.875rem", cursor:allMonthEntries.length>0?"pointer":"not-allowed" }}>
              <Icon name="download" size={14} /> Exportar CSV
            </button>
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))" }}>
            {[
              { label:"Sobreaviso",  h:totals.sobreaviso, v:totals.valorSobreaviso, formula:"⅓ do valor-hora",   tm:TYPE_META.Sobreaviso },
              { label:"Hora Extra",  h:totals.extra,      v:totals.valorExtra,      formula:"valor-hora × 1,5",  tm:TYPE_META["Hora Extra"] },
              { label:"Compensação", h:totals.comp,       v:null,                   formula:"sem valor — abate horas", tm:TYPE_META.Compensação },
            ].map(b => {
              const bg    = dark ? b.tm.bg    : b.tm.lightBg;
              const color = dark ? b.tm.color : b.tm.lightColor;
              return (
                <div key={b.label} className="rounded-xl p-3" style={{ background:bg }}>
                  <div className="text-xs font-bold" style={{ color }}>{b.label}</div>
                  <div className="text-xl font-bold" style={{ color:dark?"#F1F5F9":"#1E293B" }}>{fmtHM(b.h)}</div>
                  {b.v !== null && valorHora > 0 && <div className="text-sm font-semibold" style={{ color }}>{brl(b.v)}</div>}
                  <div className="text-[10px] mt-0.5" style={{ color, opacity:0.85 }}>{b.formula}</div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 pt-3 flex items-center justify-between" style={{ borderTop:`1px solid ${T.cardBorder}` }}>
            <span className="text-sm" style={{ color:T.labelColor }}>Total de horas: <b style={{ color:T.textPrimary }}>{fmtHM(totals.totalHoras)}</b></span>
            <div className="text-right">
              <div className="text-xs" style={{ color:T.labelColor }}>Valor total a receber</div>
              <div className="text-2xl font-bold" style={{ color:p.color }}>
                {valorHora > 0 ? brl(totals.valorTotal) : "—"}
              </div>
            </div>
          </div>
        </section>

        {/* TABELA */}
        <section className="rounded-2xl overflow-hidden" style={{ border:`1px solid ${T.cardBorder}` }}>
          <div className="px-4 py-3 flex items-center justify-between flex-wrap gap-2" style={{ background:T.cardBg, borderBottom:`1px solid ${T.cardBorder}` }}>
            <h2 className="text-sm font-semibold" style={{ color:T.textSecondary }}>
              Lançamentos ({allMonthEntries.length})
            </h2>
            <div className="flex items-center gap-3 text-[10px] font-semibold" style={{ color:T.textMuted }}>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-sm" style={{ background: dark ? TYPE_META.Sobreaviso.bg : TYPE_META.Sobreaviso.lightBg, border:`1px solid ${dark ? TYPE_META.Sobreaviso.color : TYPE_META.Sobreaviso.lightColor}` }} />
                SA · escala automática
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-sm" style={{ background: dark ? TYPE_META["Hora Extra"].bg : TYPE_META["Hora Extra"].lightBg, border:`1px solid ${dark ? TYPE_META["Hora Extra"].color : TYPE_META["Hora Extra"].lightColor}` }} />
                HE · manual
              </span>
            </div>
          </div>

          {allMonthEntries.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm" style={{ color:T.textMuted, background:T.cardBg }}>
              {dataLoading ? "Carregando…" : "Nenhum lançamento neste mês. Os sobreavisos da escala aparecem aqui automaticamente."}
            </div>
          ) : (
            <div style={{ background:T.cardBg, overflowX:"auto" }}>
              <table className="w-full text-sm" style={{ borderCollapse:"collapse", minWidth:"560px" }}>
                <thead>
                  <tr style={{ borderBottom:`1px solid ${T.divider}` }}>
                    <th style={thStyle} scope="col">Data</th>
                    <th style={thStyle} scope="col">Tipo</th>
                    <th style={thStyle} scope="col">Horário</th>
                    <th style={thStyle} scope="col">Duração</th>
                    <th style={{ ...thStyle, width:"100%" }} scope="col">Projeto / Atividade</th>
                    <th style={thStyle} scope="col"><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {allMonthEntries.map((e) => {
                    const h = durationHours(e.inicio, e.fim);
                    const tm = TYPE_META[e.tipo];
                    const tagBg    = dark ? tm.bg    : tm.lightBg;
                    const tagColor = dark ? tm.color : tm.lightColor;
                    const rowBg = e._fromSchedule
                      ? T.rowSchedBg
                      : editId === e.id ? T.rowEditBg : "transparent";

                    return (
                      <tr key={e.id} style={{ borderTop:`1px solid ${T.divider}`, background:rowBg }}>
                        <td className="font-mono font-bold whitespace-nowrap" style={{ color:T.textSecondary, padding:"0.5rem" }}>
                          {e.data.slice(8,10)}/{e.data.slice(5,7)}
                        </td>
                        <td style={{ padding:"0.5rem" }}>
                          <span className="rounded-md px-2 py-0.5 text-xs font-bold whitespace-nowrap" style={{ background:tagBg, color:tagColor }}>
                            {e._fromSchedule ? "SA" : e.tipo === "Hora Extra" ? "HE" : "Comp"}
                          </span>
                        </td>
                        <td className="font-mono text-xs whitespace-nowrap" style={{ color:T.textMuted, padding:"0.5rem" }}>{e.inicio}–{e.fim}</td>
                        <td className="font-mono text-xs font-bold whitespace-nowrap" style={{ color:T.textSecondary, padding:"0.5rem" }}>{fmtHM(h)}</td>
                        <td className="truncate" style={{ color:T.textSecondary, padding:"0.5rem", maxWidth:"1px", width:"100%" }}>
                          {e.projeto && <b style={{ color:T.textPrimary }}>{e.projeto}: </b>}{e.atividade}
                        </td>
                        <td style={{ padding:"0.15rem 0.35rem", whiteSpace:"nowrap" }}>
                          {!e._fromSchedule && (
                            <span className="inline-flex">
                              <button onClick={() => startEdit(e)}
                                aria-label={`Editar lançamento de ${e.data.slice(8,10)}/${e.data.slice(5,7)}`}
                                style={{ background:"none", border:"none", cursor:"pointer", color:T.textMuted, display:"inline-flex", alignItems:"center", justifyContent:"center", width:"2.5rem", height:"2.5rem", borderRadius:"0.5rem" }}>
                                <Icon name="pencil" size={14} />
                              </button>
                              <button onClick={() => remove(e)}
                                aria-label={`Excluir lançamento de ${e.data.slice(8,10)}/${e.data.slice(5,7)}`}
                                style={{ background:"none", border:"none", cursor:"pointer", color:"#F87171", display:"inline-flex", alignItems:"center", justifyContent:"center", width:"2.5rem", height:"2.5rem", borderRadius:"0.5rem" }}>
                                <Icon name="x" size={14} />
                              </button>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <footer className="mt-6 text-center text-xs" style={{ color:T.footerText }}>
          SA preenchido automaticamente pela escala · HE e compensação lançados manualmente · Dados salvos na nuvem
        </footer>
      </div>

      <Snackbar
        open={!!undoEntry}
        message={undoEntry ? `Lançamento de ${undoEntry.data ? `${undoEntry.data.slice(8,10)}/${undoEntry.data.slice(5,7)}` : ''} excluído` : ''}
        actionLabel="Desfazer"
        onAction={undoRemove}
        T={T}
      />
    </div>
  );
}
