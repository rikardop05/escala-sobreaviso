import { useState, useMemo, useEffect, useRef } from 'react';
import { useApi } from '../lib/api';
import {
  PEOPLE, DOW, DOW_SHORT, MONTHS, MONTHS_SHORT,
  MS_DAY, dayKey, sameDay, fmtDS,
  buildSchedule, currentOnCall, getActiveSub, getCoverSuggestions,
} from '../lib/schedule';

function PersonTag({ name, dim, subOf }) {
  const p = PEOPLE[name] || { color: "#555", bg: "#eee" };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-sm font-bold"
      style={{ color: p.color, background: dim ? "transparent" : p.bg, opacity: dim ? 0.3 : 1 }}
    >
      <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
      {name}
      {subOf && (
        <span style={{ fontSize:"0.6rem", fontWeight:"700", background:"rgba(0,0,0,0.12)", borderRadius:"3px", padding:"0 3px", letterSpacing:"0.03em" }}>
          sub
        </span>
      )}
    </span>
  );
}

export default function EscalaSobreaviso({ dark, onToggleDark, profile, saveProfile }) {
  const api = useApi();
  const isAdmin = profile?.role === 'admin';

  const [now,      setNow]      = useState(new Date());
  const [filter,   setFilter]   = useState(profile?.filter ?? null);
  const [monthKey, setMonthKey] = useState(profile?.monthKey ?? null);
  const [subs,     setSubs]     = useState([]);
  const [subForm,  setSubForm]  = useState({ show: false, titular: "", substituto: "", from: "", until: "" });
  const [subsLoading, setSubsLoading] = useState(true);
  const [subSaving,   setSubSaving]   = useState(false);
  const [subError,    setSubError]    = useState(null);
  const todayRef = useRef(null);

  // ─── OVERRIDES DE ESCALA ─────────────────────────────────────────────────────
  const [overrides,      setOverrides]      = useState({});
  const [editMode,       setEditMode]       = useState(false);
  const [selectedShifts, setSelectedShifts] = useState(new Set());
  const [editForm,       setEditForm]       = useState({ person: '', period: '', time: '', dur: '' });
  const [editSaving,     setEditSaving]     = useState(false);
  const [editError,      setEditError]      = useState(null);
  const [applyToFuture,  setApplyToFuture]  = useState(false);

  // Carrega substituições e overrides do servidor
  useEffect(() => {
    api('/api/substitutions')
      .then(data => setSubs(data || []))
      .catch(console.error)
      .finally(() => setSubsLoading(false));
    api('/api/schedule')
      .then(data => setOverrides(data || {}))
      .catch(console.error);
  }, []);

  // Relógio
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  const handleFilterChange = (name) => {
    const next = filter === name ? null : name;
    setFilter(next);
    saveProfile({ filter: next });
  };

  const handleMonthChange = (key) => {
    setMonthKey(key);
    saveProfile({ monthKey: key });
  };

  // Schedule recomputes when overrides change (admin edits reflect immediately)
  const schedule = useMemo(() => buildSchedule(overrides), [overrides]);
  const todayStr = dayKey(now);

  const months = useMemo(() => {
    const seen = new Map();
    schedule.forEach(d => {
      const k = `${d.date.getFullYear()}-${d.date.getMonth()}`;
      if (!seen.has(k)) seen.set(k, { key:k, y:d.date.getFullYear(), m:d.date.getMonth() });
    });
    return [...seen.values()];
  }, [schedule]);

  const activeMonth = monthKey || (() => {
    const k = `${now.getFullYear()}-${now.getMonth()}`;
    return months.some(m => m.key === k) ? k : months[0].key;
  })();

  // Scrolla para hoje quando o mês ativo for o mês atual
  useEffect(() => {
    const currentMonthKey = `${now.getFullYear()}-${now.getMonth()}`;
    if (activeMonth === currentMonthKey && todayRef.current) {
      todayRef.current.scrollIntoView({ behavior: 'instant', block: 'start' });
    }
  }, [activeMonth]);

  const monthDays = useMemo(
    () => schedule.filter(d => `${d.date.getFullYear()}-${d.date.getMonth()}` === activeMonth),
    [schedule, activeMonth]
  );

  const onCallBase = currentOnCall(now, schedule);
  const onCall = onCallBase ? (() => {
    const sub = getActiveSub(onCallBase.person, todayStr, subs);
    return sub ? { ...onCallBase, person: sub.substituto, coveringFor: onCallBase.person } : onCallBase;
  })() : null;
  const onCallColor = onCall ? (PEOPLE[onCall.person] || {}).color || "#94A3B8" : "#94A3B8";

  const coverSuggestions = useMemo(() => {
    if (!subForm.titular || !subForm.from || !subForm.until || subForm.from > subForm.until) return [];
    return getCoverSuggestions(subForm.titular, subForm.from, subForm.until, schedule);
  }, [subForm.titular, subForm.from, subForm.until, schedule]);

  const upcoming = useMemo(() => {
    if (!filter) return [];
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const rows = [];
    for (const d of schedule) {
      if (d.date < today) continue;
      const dk = dayKey(d.date);
      d.shifts.forEach(s => {
        const sub = getActiveSub(s.person, dk, subs);
        const effective = sub ? sub.substituto : s.person;
        if (s.person === filter) {
          rows.push({ date:d.date, dow:d.dow, ...s, kind:"turno", coveredBy: sub ? sub.substituto : null });
        } else if (effective === filter) {
          rows.push({ date:d.date, dow:d.dow, ...s, person:filter, kind:"turno", coveringFor: s.person });
        }
      });
      if (d.folga === filter && d.dow === 6) {
        const sub = getActiveSub(filter, dayKey(d.date), subs);
        if (!sub) rows.push({ date:d.date, dow:d.dow, period:"Folga FDS", time:"Sáb + Dom", dur:"", person:filter, kind:"folga" });
      }
      if (rows.length >= 30) break;
    }
    rows.sort((a, b) => a.date - b.date);
    return rows.slice(0, 25);
  }, [filter, schedule, now, subs]);

  const activeTitulares = useMemo(
    () => new Set(subs.filter(s => s.from <= todayStr && s.until >= todayStr).map(s => s.titular)),
    [subs, todayStr]
  );

  const canSave = subForm.titular && subForm.substituto && subForm.from && subForm.until
                  && subForm.from <= subForm.until && subForm.titular !== subForm.substituto;

  function openSubForm() {
    setSubForm(f => ({ ...f, show: true, from: f.from || todayStr }));
  }

  async function addSub() {
    if (!canSave || subSaving) return;
    setSubError(null);
    setSubSaving(true);
    const newSub = { titular: subForm.titular, substituto: subForm.substituto, from: subForm.from, until: subForm.until };
    try {
      const saved = await api('/api/substitutions', { method: 'POST', body: newSub });
      setSubs(prev => [...prev, saved]);
      setSubForm({ show: false, titular: "", substituto: "", from: todayStr, until: "" });
    } catch (e) {
      let msg = e.message;
      try { msg = JSON.parse(e.message)?.error || e.message; } catch {}
      setSubError(`Erro: ${msg}`);
    } finally {
      setSubSaving(false);
    }
  }

  async function removeSub(id) {
    setSubs(prev => prev.filter(s => s.id !== id));
    try {
      await api(`/api/substitutions?id=${id}`, { method: 'DELETE' });
    } catch (e) {
      console.error('Erro ao remover substituição:', e);
    }
  }

  // ─── EDIÇÃO DE ESCALA (ADMIN) ─────────────────────────────────────────────

  function toggleEditMode() {
    setEditMode(e => !e);
    setSelectedShifts(new Set());
    setEditError(null);
    setEditForm({ person: '', period: '', time: '', dur: '' });
    setApplyToFuture(false);
  }

  // Expands a base patch (selected shifts only) to all future occurrences of the
  // same shift pattern: same weekday for weekday shifts, same cycle-week + dow for weekend shifts.
  function expandPatchToFuture(basePatch) {
    const expanded = {};
    for (const [dk, shifts] of Object.entries(basePatch)) {
      const entry = schedule.find(e => dayKey(e.date) === dk);
      if (!entry) continue;
      const isWeekend = entry.dow === 0 || entry.dow === 6;
      for (const [idx, overrideValue] of Object.entries(shifts)) {
        const numIdx = parseInt(idx);
        for (const e of schedule) {
          const eDk = dayKey(e.date);
          if (eDk < dk) continue;
          if (!e.shifts[numIdx]) continue;
          const matches = isWeekend
            ? (e.dow === 0 || e.dow === 6) && e.cycleWeek === entry.cycleWeek && e.dow === entry.dow
            : e.dow === entry.dow;
          if (matches) {
            if (!expanded[eDk]) expanded[eDk] = {};
            expanded[eDk][idx] = overrideValue;
          }
        }
      }
    }
    return expanded;
  }

  function toggleShift(dk, shiftIdx) {
    const key = `${dk}-${shiftIdx}`;
    setSelectedShifts(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function applyEditOverrides() {
    if (!selectedShifts.size || editSaving) return;
    setEditSaving(true);
    setEditError(null);
    const basePatch = {};
    for (const key of selectedShifts) {
      const lastDash = key.lastIndexOf('-');
      const dk = key.slice(0, lastDash);
      const idx = key.slice(lastDash + 1);
      if (!basePatch[dk]) basePatch[dk] = {};
      const override = {};
      if (editForm.person)  override.person  = editForm.person;
      if (editForm.period)  override.period  = editForm.period;
      if (editForm.time)    override.time    = editForm.time;
      if (editForm.dur)     override.dur     = editForm.dur;
      basePatch[dk][idx] = Object.keys(override).length ? override : null;
    }
    const patch = applyToFuture ? expandPatchToFuture(basePatch) : basePatch;
    try {
      const updated = await api('/api/schedule', { method: 'POST', body: patch });
      setOverrides(updated);
      setSelectedShifts(new Set());
      setEditForm({ person: '', period: '', time: '', dur: '' });
      setApplyToFuture(false);
    } catch (e) {
      let msg = e.message;
      try { msg = JSON.parse(e.message)?.error || e.message; } catch {}
      setEditError(`Erro: ${msg}`);
    } finally {
      setEditSaving(false);
    }
  }

  async function resetSelectedShifts() {
    if (!selectedShifts.size || editSaving) return;
    setEditSaving(true);
    const basePatch = {};
    for (const key of selectedShifts) {
      const lastDash = key.lastIndexOf('-');
      const dk = key.slice(0, lastDash);
      const idx = key.slice(lastDash + 1);
      if (!basePatch[dk]) basePatch[dk] = {};
      basePatch[dk][idx] = null;
    }
    const patch = applyToFuture ? expandPatchToFuture(basePatch) : basePatch;
    try {
      const updated = await api('/api/schedule', { method: 'POST', body: patch });
      setOverrides(updated);
      setSelectedShifts(new Set());
      setApplyToFuture(false);
    } catch (e) {
      console.error('Erro ao resetar:', e);
    } finally {
      setEditSaving(false);
    }
  }

  const fmtDate = (d) => `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
  const am = months.find(m => m.key === activeMonth);

  // Count of shifts that would be affected by "apply to future months"
  const futureShiftCount = useMemo(() => {
    if (!applyToFuture || !selectedShifts.size) return 0;
    let count = 0;
    for (const key of selectedShifts) {
      const lastDash = key.lastIndexOf('-');
      const dk = key.slice(0, lastDash);
      const idx = key.slice(lastDash + 1);
      const entry = schedule.find(e => dayKey(e.date) === dk);
      if (!entry) continue;
      const isWeekend = entry.dow === 0 || entry.dow === 6;
      const numIdx = parseInt(idx);
      count += schedule.filter(e => {
        const eDk = dayKey(e.date);
        if (eDk < dk) return false;
        if (!e.shifts[numIdx]) return false;
        return isWeekend
          ? (e.dow === 0 || e.dow === 6) && e.cycleWeek === entry.cycleWeek && e.dow === entry.dow
          : e.dow === entry.dow;
      }).length;
    }
    return count;
  }, [applyToFuture, selectedShifts, schedule]);

  // Substitutions that overlap the currently displayed month
  const monthSubs = useMemo(() => {
    if (!am) return subs;
    const firstDay = `${am.y}-${String(am.m + 1).padStart(2, '0')}-01`;
    const lastDate  = new Date(am.y, am.m + 1, 0);
    const lastDay   = `${am.y}-${String(am.m + 1).padStart(2, '0')}-${String(lastDate.getDate()).padStart(2, '0')}`;
    return subs.filter(s => s.from <= lastDay && s.until >= firstDay);
  }, [subs, activeMonth, months]);

  // ─── TEMA ────────────────────────────────────────────────────────────────────
  const T = dark ? {
    pageBg:"#0F172A", cardBg:"#1E293B", cardBgWeekend:"#1A2336",
    cardBorder:"#334155", cardBorderToday:"#94A3B8",
    headerGrad:"linear-gradient(135deg,#020617 0%,#0F172A 100%)",
    dateColBg:"#162032", dateColBgWeekend:"#1C2840", dateColBorder:"#334155",
    upcomingBg:"#1E293B", upcomingBorder:"#334155", upcomingDivider:"#263347",
    cycleBg:"#334155", cycleColor:"#94A3B8",
    labelColor:"#475569", textPrimary:"#F1F5F9", textSecondary:"#94A3B8", textMuted:"#64748B",
    periodColor:"#94A3B8", timeColor:"#64748B", durColor:"#475569",
    dateNumColor:"#CBD5E1", monthShortColor:"#475569",
    filterAllBg:"#F1F5F9", filterAllColor:"#0F172A", filterAllBorder:"#F1F5F9",
    filterDefBg:"#1E293B", filterDefColor:"#64748B", filterDefBorder:"#334155",
    monthActiveBg:"#F1F5F9", monthActiveColor:"#0F172A", monthActiveBorder:"#F1F5F9",
    monthDefBg:"#1E293B", monthDefColor:"#64748B", monthDefBorder:"#334155",
    inputBg:"#0F172A", saveBg:"#F1F5F9", saveColor:"#0F172A",
  } : {
    pageBg:"#EEF1F6", cardBg:"#fff", cardBgWeekend:"#FDFBEF",
    cardBorder:"#E2E8F0", cardBorderToday:"#1E293B",
    headerGrad:"linear-gradient(135deg,#1E293B 0%,#334155 100%)",
    dateColBg:"#F1F5F9", dateColBgWeekend:"#F5EFD0", dateColBorder:"#E2E8F0",
    upcomingBg:"#fff", upcomingBorder:"#E2E8F0", upcomingDivider:"#F1F5F9",
    cycleBg:"#E2E8F0", cycleColor:"#475569",
    labelColor:"#64748B", textPrimary:"#1E293B", textSecondary:"#475569", textMuted:"#94A3B8",
    periodColor:"#475569", timeColor:"#94A3B8", durColor:"#94A3B8",
    dateNumColor:"#1E293B", monthShortColor:"#94A3B8",
    filterAllBg:"#1E293B", filterAllColor:"#fff", filterAllBorder:"#1E293B",
    filterDefBg:"#fff", filterDefColor:"#475569", filterDefBorder:"#CBD5E1",
    monthActiveBg:"#1E293B", monthActiveColor:"#fff", monthActiveBorder:"#1E293B",
    monthDefBg:"#fff", monthDefColor:"#475569", monthDefBorder:"#E2E8F0",
    inputBg:"#fff", saveBg:"#1E293B", saveColor:"#fff",
  };

  const selStyle = {
    display:"block", width:"100%", padding:"0.35rem 0.5rem", fontSize:"0.8rem",
    borderRadius:"0.4rem", border:`1px solid ${T.cardBorder}`,
    background:T.inputBg, color:T.textPrimary, marginTop:"0.25rem", outline:"none",
  };

  return (
    <div style={{ minHeight:"100vh", background:T.pageBg, fontFamily:"'Segoe UI',system-ui,sans-serif", color:T.textPrimary, transition:"background 0.2s,color 0.2s" }}>
      <div className="max-w-3xl mx-auto px-4 py-6">

        {/* CABEÇALHO */}
        <div className="rounded-2xl p-5 mb-5 text-white" style={{ background:T.headerGrad, position:"relative" }}>
          <button
            onClick={onToggleDark}
            style={{ position:"absolute", top:"0.75rem", right:"0.75rem", background:"rgba(255,255,255,0.12)", color:"#fff", border:"1px solid rgba(255,255,255,0.22)", borderRadius:"9999px", padding:"0.2rem 0.65rem", fontSize:"0.7rem", fontWeight:"600", cursor:"pointer", letterSpacing:"0.03em", lineHeight:"1.6" }}
          >
            {dark ? "☀ Claro" : "🌙 Escuro"}
          </button>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-widest opacity-60 mb-1">Escala de Sobreaviso</div>
              <div className="text-2xl font-bold">{DOW[now.getDay()]}, {fmtDate(now)}/{now.getFullYear()}</div>
            </div>
            <div className="rounded-xl px-4 py-3 min-w-[200px]" style={{ background:"rgba(255,255,255,0.08)", borderLeft:`4px solid ${onCallColor}` }}>
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider opacity-70">
                <span className="relative flex w-2 h-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background:onCallColor }} />
                  <span className="relative inline-flex rounded-full w-2 h-2" style={{ background:onCallColor }} />
                </span>
                Agora
              </div>
              {onCall ? (
                <>
                  <div className="text-lg font-bold" style={{ color: onCallColor === "#37474F" ? "#CBD5E1" : onCallColor }}>{onCall.person}</div>
                  <div className="text-xs opacity-70">
                    {onCall.label} · {onCall.time}
                    {onCall.coveringFor && <span className="ml-1 opacity-80">· cobre {onCall.coveringFor}</span>}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-lg font-bold opacity-90">Sem sobreaviso</div>
                  <div className="text-xs opacity-70">Horário comercial (09:00 – 18:00)</div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* FILTRO */}
        <div className="mb-4">
          <div className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color:T.labelColor }}>Filtrar por responsável</div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => { setFilter(null); saveProfile({ filter: null }); }} className="px-3 py-1.5 rounded-full text-sm font-bold transition-all"
              style={{ background:!filter?T.filterAllBg:T.filterDefBg, color:!filter?T.filterAllColor:T.filterDefColor, border:"1.5px solid "+(!filter?T.filterAllBorder:T.filterDefBorder) }}>
              Todos
            </button>
            {Object.entries(PEOPLE).map(([name, p]) => {
              const isFeriasHoje = activeTitulares.has(name);
              return (
                <button key={name} onClick={() => handleFilterChange(name)} className="px-3 py-1.5 rounded-full text-sm font-bold transition-all"
                  style={{ background:filter===name?p.color:T.filterDefBg, color:filter===name?"#fff":p.color, border:`1.5px solid ${filter===name?p.color:T.filterDefBorder}` }}>
                  {name}{isFeriasHoje ? " 🌴" : ""}
                </button>
              );
            })}
          </div>
        </div>

        {/* PRÓXIMOS PLANTÕES */}
        {filter && (
          <div className="rounded-2xl p-4 mb-5" style={{ background:T.upcomingBg, border:`1px solid ${T.upcomingBorder}` }}>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-3 h-3 rounded-full" style={{ background: PEOPLE[filter].color }} />
              <h2 className="font-bold text-base">Próximos sobreavisos de {filter}</h2>
            </div>
            {upcoming.length === 0 ? (
              <div className="text-sm" style={{ color:T.textMuted }}>Nenhum plantão encontrado no período.</div>
            ) : (
              <div>
                {upcoming.map((u, i) => (
                  <div key={i} className="flex items-center justify-between py-2 text-sm gap-2 flex-wrap"
                    style={{ borderTop: i>0?`1px solid ${T.upcomingDivider}`:"none", opacity: u.coveredBy ? 0.5 : 1 }}>
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-mono font-bold w-14" style={{ color:T.textSecondary }}>{fmtDate(u.date)}</span>
                      <span className="w-10" style={{ color:T.textMuted }}>{DOW_SHORT[u.dow]}</span>
                      {u.kind === "folga" ? (
                        <span className="rounded-md px-2 py-0.5 text-xs font-bold" style={{ background:"#FEF9C3", color:"#854D0E" }}>🏖 Folga FDS</span>
                      ) : (
                        <span className="font-semibold" style={{ color: PEOPLE[filter].color }}>{u.period}</span>
                      )}
                      {u.coveringFor && <span className="text-[10px] font-bold rounded px-1.5 py-0.5" style={{ background:"#DBEAFE", color:"#1D4ED8" }}>cobre {u.coveringFor}</span>}
                      {u.coveredBy  && <span className="text-[10px] font-bold rounded px-1.5 py-0.5" style={{ background:"#F3E5F5", color:"#7B1FA2" }}>coberto por {u.coveredBy}</span>}
                    </div>
                    <span className="font-mono text-xs" style={{ color:T.textMuted }}>{u.time}{u.dur?` · ${u.dur}`:""}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* NAVEGAÇÃO DE MESES + BOTÃO DE EDIÇÃO (admin) */}
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 min-w-0 rounded-xl px-3 py-2" style={{ background:T.cardBg, border:`1px solid ${editMode ? '#6366F1' : T.cardBorder}` }}>
            <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth:"thin", scrollbarColor:`${T.cardBorder} transparent` }}>
              {months.map(m => (
                <button key={m.key} onClick={() => handleMonthChange(m.key)} className="px-3 py-1.5 rounded-lg text-sm font-bold whitespace-nowrap transition-all flex-shrink-0"
                  style={{ background:activeMonth===m.key?T.monthActiveBg:T.monthDefBg, color:activeMonth===m.key?T.monthActiveColor:T.monthDefColor, border:"1px solid "+(activeMonth===m.key?T.monthActiveBorder:T.monthDefBorder) }}>
                  {MONTHS_SHORT[m.m]}/{String(m.y).slice(2)}
                </button>
              ))}
            </div>
          </div>
          {isAdmin && (
            <button
              onClick={toggleEditMode}
              style={{ flexShrink:0, background: editMode ? '#6366F1' : T.cardBg, color: editMode ? '#fff' : T.textSecondary, border:`1px solid ${editMode ? '#6366F1' : T.cardBorder}`, borderRadius:"0.75rem", padding:"0.5rem 0.85rem", fontSize:"0.75rem", fontWeight:"700", cursor:"pointer", whiteSpace:"nowrap" }}
            >
              {editMode ? '✕ Sair da edição' : '✏ Editar Escala'}
            </button>
          )}
        </div>

        {/* CALENDÁRIO */}
        <h2 className="font-bold text-lg mb-2" style={{ color:T.textPrimary }}>{am?`${MONTHS[am.m]} de ${am.y}`:""}</h2>
        <div style={{ height:'62vh', overflowY:'auto', scrollbarWidth:'thin', scrollbarColor:`${T.cardBorder} transparent`, paddingRight:'2px' }}>
        <div className="space-y-2 pb-4">
          {monthDays.map(d => {
            const isToday   = sameDay(d.date, now);
            const isWeekend = d.dow === 0 || d.dow === 6;
            const isPast    = !isToday && d.date < now;
            const dk        = dayKey(d.date);
            const hasFiltered = !filter || d.shifts.some(s => {
              const sub = getActiveSub(s.person, dk, subs);
              return (sub ? sub.substituto : s.person) === filter || s.person === filter;
            }) || d.folga === filter;
            return (
              <div key={dayKey(d.date)} ref={isToday ? todayRef : null} className="rounded-xl overflow-hidden"
                style={{ scrollMarginTop:'8px', border:`${isToday?2:1}px solid ${isToday?T.cardBorderToday:T.cardBorder}`, opacity: isPast?0.45:filter&&!hasFiltered?0.35:1, background:isWeekend?T.cardBgWeekend:T.cardBg }}>
                <div className="flex items-stretch">
                  <div className="flex flex-col items-center justify-center w-16 shrink-0 py-3"
                    style={{ background:isWeekend?T.dateColBgWeekend:T.dateColBg, borderRight:`1px solid ${T.dateColBorder}` }}>
                    <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color:T.textMuted }}>{DOW_SHORT[d.dow]}</div>
                    <div className="text-xl font-bold leading-tight" style={{ color:T.dateNumColor }}>{String(d.date.getDate()).padStart(2,"0")}</div>
                    <div className="text-[10px]" style={{ color:T.monthShortColor }}>{MONTHS_SHORT[d.date.getMonth()]}</div>
                    {isToday && <div className="mt-1 text-[9px] font-bold text-white bg-slate-800 rounded px-1.5 py-0.5">HOJE</div>}
                  </div>
                  <div className="flex-1 px-3 py-2">
                    {isWeekend && d.dow === 6 && (
                      <div className="flex flex-wrap items-center gap-2 mb-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5" style={{ background:T.cycleBg, color:T.cycleColor }}>
                          Semana {d.cycleWeek} do ciclo
                        </span>
                        <span className="text-[10px] font-bold rounded px-1.5 py-0.5" style={{ background:"#FEF9C3", color:"#854D0E", opacity: filter&&d.folga!==filter?0.4:1 }}>
                          🏖 Folga FDS: {d.folga}
                        </span>
                      </div>
                    )}
                    <div className="space-y-0.5">
                      {d.shifts.map((s, i) => {
                        const sub = getActiveSub(s.person, dk, subs);
                        const effectivePerson = sub ? sub.substituto : s.person;
                        const dim = !!(filter && effectivePerson !== filter && s.person !== filter);
                        const shiftKey = `${dk}-${i}`;
                        const isSelected = selectedShifts.has(shiftKey);
                        const hasOverride = !!(overrides[dk]?.[String(i)]);
                        return (
                          <div key={i}
                            onClick={() => editMode && toggleShift(dk, i)}
                            className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm"
                            style={{
                              opacity: dim ? 0.3 : 1,
                              cursor: editMode ? 'pointer' : 'default',
                              background: isSelected ? 'rgba(99,102,241,0.12)' : 'transparent',
                              borderRadius: '0.375rem',
                              padding: editMode ? '0.2rem 0.35rem' : '0.1rem 0',
                              outline: isSelected ? '1.5px solid #6366F1' : 'none',
                              margin: editMode ? '0.05rem 0' : undefined,
                            }}>
                            {editMode && (
                              <span style={{ width:'1rem', height:'1rem', borderRadius:'3px', border:`1.5px solid ${isSelected?'#6366F1':T.cardBorder}`, background:isSelected?'#6366F1':'transparent', display:'inline-flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                {isSelected && <span style={{ color:'#fff', fontSize:'0.6rem', fontWeight:'900', lineHeight:1 }}>✓</span>}
                              </span>
                            )}
                            <span className="w-24 font-semibold" style={{ color: hasOverride ? '#818CF8' : T.periodColor }}>{s.period}</span>
                            <span className="font-mono text-xs w-28" style={{ color: hasOverride ? '#818CF8' : T.timeColor }}>{s.time}</span>
                            <span className="font-mono text-xs w-7" style={{ color:T.durColor }}>{s.dur}</span>
                            <PersonTag name={effectivePerson} subOf={sub ? s.person : null} />
                            {hasOverride && (
                              <span style={{ fontSize:'0.6rem', color:'#818CF8', fontWeight:'700', background:'rgba(99,102,241,0.1)', borderRadius:'3px', padding:'0 3px' }}>editado</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        </div>

        {/* SUBSTITUIÇÕES */}
        <div className="rounded-2xl p-4 mt-4" style={{ background:T.cardBg, border:`1px solid ${T.cardBorder}` }}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color:T.labelColor }}>Substituições</span>
              {monthSubs.length > 0 && (
                <span className="text-[10px] font-bold rounded-full px-2 py-0.5" style={{ background:"#DBEAFE", color:"#1D4ED8" }}>
                  {monthSubs.length} ativa{monthSubs.length > 1 ? "s" : ""}
                </span>
              )}
            </div>
            {/* Viewers cannot create substitutions */}
            {profile?.role !== 'viewer' && (
              <button
                onClick={subForm.show ? () => setSubForm(f => ({ ...f, show:false })) : openSubForm}
                style={{ background:"transparent", border:`1px solid ${T.cardBorder}`, borderRadius:"9999px", padding:"0.2rem 0.65rem", fontSize:"0.72rem", fontWeight:"700", cursor:"pointer", color:T.textSecondary }}
              >
                {subForm.show ? "Cancelar" : "+ Adicionar"}
              </button>
            )}
          </div>

          {monthSubs.length === 0 && !subForm.show && !subsLoading && (
            <div className="text-xs" style={{ color:T.textMuted }}>Nenhuma substituição neste mês. Use para férias ou trocas eventuais.</div>
          )}
          {subsLoading && <div className="text-xs" style={{ color:T.textMuted }}>Carregando...</div>}

          {monthSubs.map((s, i) => {
            // Show delete only to admin, or to member if they appear in the substitution
            const canDelete = isAdmin
              || (profile?.role === 'member' && (s.titular === profile?.memberId || s.substituto === profile?.memberId));
            return (
              <div key={s.id} className="flex items-center justify-between py-2 flex-wrap gap-y-1"
                style={{ borderTop: `1px solid ${T.upcomingDivider}` }}>
                <div className="flex items-center gap-2 flex-wrap text-sm">
                  <PersonTag name={s.titular} />
                  <span style={{ color:T.textMuted, fontSize:"1rem" }}>→</span>
                  <PersonTag name={s.substituto} />
                  <span className="text-xs font-mono" style={{ color:T.textMuted }}>{fmtDS(s.from)} – {fmtDS(s.until)}</span>
                </div>
                {canDelete && (
                  <button onClick={() => removeSub(s.id)}
                    style={{ background:"transparent", border:"none", cursor:"pointer", color:T.textMuted, fontSize:"1rem", lineHeight:1, padding:"0 0.25rem" }}>
                    ✕
                  </button>
                )}
              </div>
            );
          })}

          {subForm.show && (
            <div className="mt-3 pt-3" style={{ borderTop:`1px solid ${T.cardBorder}` }}>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color:T.labelColor }}>Titular (ausente)</label>
                  <select value={subForm.titular} onChange={e => setSubForm(f => ({ ...f, titular:e.target.value, substituto: f.substituto===e.target.value?"":f.substituto }))} style={selStyle}>
                    <option value="">Selecionar...</option>
                    {Object.keys(PEOPLE).map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color:T.labelColor }}>Substituto</label>
                  <select value={subForm.substituto} onChange={e => setSubForm(f => ({ ...f, substituto:e.target.value }))} style={selStyle}>
                    <option value="">Selecionar...</option>
                    {Object.keys(PEOPLE).filter(p => p !== subForm.titular).map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color:T.labelColor }}>De</label>
                  <input type="date" value={subForm.from} onChange={e => setSubForm(f => ({ ...f, from:e.target.value }))} style={selStyle} />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color:T.labelColor }}>Até</label>
                  <input type="date" value={subForm.until} onChange={e => setSubForm(f => ({ ...f, until:e.target.value }))} style={selStyle} />
                </div>
              </div>
              <button onClick={addSub} disabled={!canSave || subSaving}
                style={{ background:canSave&&!subSaving?T.saveBg:T.cardBorder, color:canSave&&!subSaving?T.saveColor:T.textMuted, border:"none", borderRadius:"0.5rem", padding:"0.4rem 1.1rem", fontWeight:"700", fontSize:"0.8rem", cursor:canSave&&!subSaving?"pointer":"not-allowed", transition:"background 0.15s" }}>
                {subSaving ? "Salvando..." : "Salvar substituição"}
              </button>
              {subError && (
                <p style={{ color:"#EF4444", fontSize:"0.75rem", fontWeight:"600", marginTop:"0.5rem", marginBottom:0 }}>{subError}</p>
              )}

              {coverSuggestions.length > 0 && (
                <div className="mt-4 pt-3" style={{ borderTop:`1px solid ${T.upcomingDivider}` }}>
                  <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color:T.labelColor }}>
                    {subForm.substituto
                      ? `${subForm.substituto} cobrirá ${coverSuggestions.length} dia${coverSuggestions.length>1?"s":""} de ${subForm.titular || "..."}`
                      : `${coverSuggestions.length} dia${coverSuggestions.length>1?"s":""} a cobrir — quem está livre`}
                  </div>
                  <div>
                    {coverSuggestions.slice(0, 12).map((day, i) => (
                      <div key={i} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 text-xs py-1.5"
                        style={{ borderTop: i > 0 ? `1px solid ${T.upcomingDivider}` : "none" }}>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold" style={{ color:T.textSecondary }}>{fmtDate(day.date)}</span>
                          <span style={{ color:T.textMuted }}>{DOW_SHORT[day.dow]}</span>
                          <span style={{ color:T.periodColor }}>{day.shifts.map(s => s.period).join(" + ")}</span>
                          <span style={{ color:T.timeColor }}>{day.shifts.map(s => s.time).join(" / ")}</span>
                        </div>
                        {!subForm.substituto && (
                          <span style={{ color: day.available.length ? T.textSecondary : "#EF4444" }}>
                            {day.available.length ? `Livres: ${day.available.join(", ")}` : "⚠ Todos ocupados"}
                          </span>
                        )}
                      </div>
                    ))}
                    {coverSuggestions.length > 12 && (
                      <div className="text-xs mt-1" style={{ color:T.textMuted }}>… e mais {coverSuggestions.length - 12} dias</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* PAINEL DE EDIÇÃO (admin, sticky na parte inferior) */}
        {isAdmin && editMode && (
          <div style={{ position:'sticky', bottom:'1rem', marginTop:'1rem', background: dark ? '#1E293B' : '#fff', border:`1.5px solid ${selectedShifts.size ? '#6366F1' : T.cardBorder}`, borderRadius:'1rem', padding:'1rem', boxShadow:'0 8px 32px rgba(0,0,0,0.35)', zIndex:40 }}>
            <div className="flex items-center justify-between mb-3">
              <span style={{ fontWeight:700, fontSize:'0.875rem', color:T.textPrimary }}>
                {selectedShifts.size === 0
                  ? 'Clique nos turnos do calendário para selecioná-los'
                  : `${selectedShifts.size} turno${selectedShifts.size > 1 ? 's' : ''} selecionado${selectedShifts.size > 1 ? 's' : ''}`}
              </span>
              {selectedShifts.size > 0 && (
                <button onClick={() => setSelectedShifts(new Set())} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'0.78rem', color:T.textMuted }}>
                  Limpar seleção
                </button>
              )}
            </div>

            {selectedShifts.size > 0 && (
              <>
                <div className="grid gap-3 mb-3" style={{ gridTemplateColumns:'repeat(auto-fit, minmax(130px, 1fr))' }}>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color:T.labelColor }}>Pessoa</div>
                    <select value={editForm.person} onChange={e => setEditForm(f => ({ ...f, person:e.target.value }))} style={selStyle}>
                      <option value="">Manter original</option>
                      {Object.keys(PEOPLE).map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color:T.labelColor }}>Período</div>
                    <input value={editForm.period} onChange={e => setEditForm(f => ({ ...f, period:e.target.value }))}
                      placeholder="ex: Madrugada" style={selStyle} />
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color:T.labelColor }}>Horário</div>
                    <input value={editForm.time} onChange={e => setEditForm(f => ({ ...f, time:e.target.value }))}
                      placeholder="ex: 23:00 – 04:00" style={selStyle} />
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color:T.labelColor }}>Duração</div>
                    <input value={editForm.dur} onChange={e => setEditForm(f => ({ ...f, dur:e.target.value }))}
                      placeholder="ex: 5h" style={selStyle} />
                  </div>
                </div>

                {/* Toggle: apply to all future months */}
                <label style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.75rem', cursor:'pointer', userSelect:'none' }}>
                  <input
                    type="checkbox"
                    checked={applyToFuture}
                    onChange={e => setApplyToFuture(e.target.checked)}
                    style={{ width:'1rem', height:'1rem', cursor:'pointer', accentColor:'#6366F1' }}
                  />
                  <span style={{ fontSize:'0.8rem', fontWeight:'600', color: applyToFuture ? '#A5B4FC' : T.textSecondary }}>
                    Aplicar a todos os meses seguintes
                  </span>
                  {applyToFuture && futureShiftCount > 0 && (
                    <span style={{ fontSize:'0.72rem', fontWeight:'700', background:'rgba(245,158,11,0.15)', color:'#F59E0B', borderRadius:'9999px', padding:'0.1rem 0.5rem' }}>
                      {futureShiftCount} turno{futureShiftCount > 1 ? 's' : ''}
                    </span>
                  )}
                </label>
                {applyToFuture && (
                  <p style={{ fontSize:'0.72rem', color:'#F59E0B', fontWeight:'600', margin:'0 0 0.75rem 0' }}>
                    ⚠ Mudança permanente — afeta todos os meses até o fim da escala
                  </p>
                )}

                <div className="flex flex-wrap gap-2 items-center">
                  <button onClick={applyEditOverrides} disabled={editSaving}
                    style={{ background:editSaving?T.cardBorder:'#6366F1', color:'#fff', border:'none', borderRadius:'0.5rem', padding:'0.4rem 1rem', fontWeight:700, fontSize:'0.8rem', cursor:editSaving?'not-allowed':'pointer' }}>
                    {editSaving ? 'Salvando...' : applyToFuture ? `Aplicar a ${futureShiftCount} turnos` : 'Aplicar alteração'}
                  </button>
                  <button onClick={resetSelectedShifts} disabled={editSaving}
                    style={{ background:'transparent', color:'#EF4444', border:'1px solid #EF4444', borderRadius:'0.5rem', padding:'0.4rem 0.85rem', fontWeight:700, fontSize:'0.8rem', cursor:editSaving?'not-allowed':'pointer' }}>
                    {applyToFuture ? `Resetar ${futureShiftCount} turnos` : 'Resetar para padrão'}
                  </button>
                </div>
                {editError && <p style={{ color:'#EF4444', fontSize:'0.75rem', marginTop:'0.5rem' }}>{editError}</p>}
              </>
            )}
          </div>
        )}

        <div className="mt-4 text-center text-xs" style={{ color:T.textMuted }}>
          Ciclo de fim de semana ancorado em 13/06/2026 (Semana 1) · Escala seg–sex fixa · 5 semanas de rotação
        </div>
      </div>
    </div>
  );
}
