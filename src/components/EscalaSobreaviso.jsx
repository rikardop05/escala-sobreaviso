import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useApi } from '../lib/api';
import {
  PEOPLE, DOW, DOW_SHORT, MONTHS, MONTHS_SHORT,
  MS_DAY, dayKey, sameDay, fmtDS,
  buildSchedule, currentOnCall, adjacentOnCall, getActiveSub, getCoverSuggestions, shiftPeople,
} from '../lib/schedule';
import { getTheme, ACCENT, DANGER, WARN } from '../lib/theme';
import { Icon, Snackbar, ConfirmDialog, Skeleton, friendlyError } from './ui';

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

// Multi-seleção de pessoas (chips) — usado ao editar e ao adicionar turnos.
function PersonPicker({ selected, onToggle }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {Object.entries(PEOPLE).map(([name, p]) => {
        const on = selected.includes(name);
        return (
          <button key={name} type="button" onClick={() => onToggle(name)} aria-pressed={on}
            style={{ display:'inline-flex', alignItems:'center', gap:'0.3rem', fontSize:'0.72rem', fontWeight:700, padding:'0.35rem 0.6rem', minHeight:'2.25rem', borderRadius:'9999px', cursor:'pointer', background: on ? p.color : 'transparent', color: on ? '#fff' : p.color, border:`1.5px solid ${on ? p.color : 'rgba(148,163,184,0.45)'}` }}>
            <span style={{ width:7, height:7, borderRadius:'50%', flexShrink:0, background: on ? '#fff' : p.color }} />
            {name}
          </button>
        );
      })}
    </div>
  );
}

// Ignora um monthKey salvo que aponta para um mês já passado —
// quem abre o app quer ver o mês atual, não o último visitado.
function freshMonthKey(saved) {
  if (!saved) return null;
  const [y, m] = String(saved).split('-').map(Number);
  const now = new Date();
  if (Number.isNaN(y) || Number.isNaN(m)) return null;
  if (y < now.getFullYear() || (y === now.getFullYear() && m < now.getMonth())) return null;
  return saved;
}

// O marcador "alterado" expira após ~14 dias — evita que a grade fique
// permanentemente marcada conforme os overrides se acumulam. Guardamos só a
// data (editedAt) que o servidor carimba em cada override.
const EDIT_RECENT_MS = 14 * 86400000;
const fmtEdited = (iso) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export default function EscalaSobreaviso({ dark, onToggleDark, profile, saveProfile }) {
  const api = useApi();
  const isAdmin = profile?.role === 'admin';

  const [now,      setNow]      = useState(new Date());
  const [filter,   setFilter]   = useState(profile?.filter ?? null);
  const [monthKey, setMonthKey] = useState(() => freshMonthKey(profile?.monthKey));
  const [subs,     setSubs]     = useState([]);
  const [subForm,  setSubForm]  = useState({ show: false, titular: "", substituto: "", from: "", until: "" });
  const [subsLoading, setSubsLoading] = useState(true);
  const [subSaving,   setSubSaving]   = useState(false);
  const [subError,    setSubError]    = useState(null);
  const [undoSub,     setUndoSub]     = useState(null); // substituição recém-removida, restaurável
  const undoTimer = useRef(null);
  const todayRef = useRef(null);

  // ─── OVERRIDES DE ESCALA ─────────────────────────────────────────────────────
  const [overrides,         setOverrides]         = useState({});
  const [labels,            setLabels]            = useState({}); // { dayKey: "Feriado" }
  const [overridesLoading,  setOverridesLoading]  = useState(true);
  const [overridesError,    setOverridesError]    = useState(false);
  const [editMode,       setEditMode]       = useState(false);
  const [selectedShifts, setSelectedShifts] = useState(new Set());
  const [editForm,       setEditForm]       = useState({ persons: [], period: '', time: '', dur: '' });
  const [editSaving,     setEditSaving]     = useState(false);
  const [editError,      setEditError]      = useState(null);
  const [applyToFuture,  setApplyToFuture]  = useState(false);
  const [confirmAction,  setConfirmAction]  = useState(null); // 'apply' | 'reset' | null
  const [addDay,   setAddDay]   = useState(null); // dayKey ao qual estamos adicionando um turno
  const [addForm,  setAddForm]  = useState({ persons: [], period: '', time: '', dur: '' });

  // Carrega substituições e overrides do servidor
  const loadOverrides = useCallback(() => {
    setOverridesLoading(true);
    setOverridesError(false);
    api('/api/schedule')
      .then(data => { setOverrides(data?.overrides || {}); setLabels(data?.labels || {}); })
      .catch(err => { console.error(err); setOverridesError(true); })
      .finally(() => setOverridesLoading(false));
  }, [api]);

  useEffect(() => {
    api('/api/substitutions')
      .then(data => setSubs(data || []))
      .catch(console.error)
      .finally(() => setSubsLoading(false));
    loadOverrides();
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

  // Schedule recomputes when overrides/labels change (admin edits reflect immediately)
  const schedule = useMemo(() => buildSchedule(overrides, labels), [overrides, labels]);
  const todayStr = dayKey(now);

  const months = useMemo(() => {
    const seen = new Map();
    schedule.forEach(d => {
      const k = `${d.date.getFullYear()}-${d.date.getMonth()}`;
      if (!seen.has(k)) seen.set(k, { key:k, y:d.date.getFullYear(), m:d.date.getMonth() });
    });
    return [...seen.values()];
  }, [schedule]);

  const currentMonthKey = `${now.getFullYear()}-${now.getMonth()}`;
  const activeMonth = monthKey || (months.some(m => m.key === currentMonthKey) ? currentMonthKey : months[0].key);

  // Scrolla para hoje quando o mês ativo for o mês atual
  useEffect(() => {
    if (activeMonth === currentMonthKey && todayRef.current) {
      todayRef.current.scrollIntoView({ behavior: 'instant', block: 'start' });
    }
  }, [activeMonth, overridesLoading]);

  const goToToday = () => {
    handleMonthChange(currentMonthKey);
    // Se já estamos no mês atual o effect não redispara — força o scroll
    setTimeout(() => todayRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const monthDays = useMemo(
    () => schedule.filter(d => `${d.date.getFullYear()}-${d.date.getMonth()}` === activeMonth),
    [schedule, activeMonth]
  );

  // { people: [{ person, coveringFor }], label, time } | null — pode ter +1 pessoa (feriado)
  const onCall = currentOnCall(now, schedule, subs);
  const onCallColor = onCall && onCall.people.length === 1
    ? (PEOPLE[onCall.people[0].person] || {}).color || "#94A3B8"
    : "#94A3B8";

  // Handoff: plantonista anterior e próximo (com substituições) para o widget "Agora"
  const handoff = useMemo(() => adjacentOnCall(now, schedule, subs), [now, schedule, subs]);

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
        const people = shiftPeople(s);
        if (people.includes(filter)) {
          const sub = getActiveSub(filter, dk, subs);
          rows.push({ date:d.date, dow:d.dow, ...s, kind:"turno", coveredBy: sub ? sub.substituto : null });
        } else {
          // filter pode estar cobrindo alguém deste turno (substituto)
          const titular = people.find(p => { const sub = getActiveSub(p, dk, subs); return sub && sub.substituto === filter; });
          if (titular) rows.push({ date:d.date, dow:d.dow, ...s, kind:"turno", coveringFor: titular });
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
      setSubError(friendlyError(e));
    } finally {
      setSubSaving(false);
    }
  }

  // Remoção otimista com undo: a UI remove na hora, o snackbar oferece "Desfazer"
  // por alguns segundos e uma falha na API restaura a lista com aviso.
  async function removeSub(sub) {
    setSubError(null);
    setSubs(prev => prev.filter(s => s.id !== sub.id));
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoSub(sub);
    undoTimer.current = setTimeout(() => setUndoSub(null), 6000);
    try {
      await api(`/api/substitutions?id=${sub.id}`, { method: 'DELETE' });
    } catch (e) {
      console.error('Erro ao remover substituição:', e);
      clearTimeout(undoTimer.current);
      setUndoSub(null);
      setSubs(prev => [...prev, sub]);
      setSubError(friendlyError(e));
    }
  }

  async function undoRemoveSub() {
    if (!undoSub) return;
    const sub = undoSub;
    clearTimeout(undoTimer.current);
    setUndoSub(null);
    try {
      const saved = await api('/api/substitutions', {
        method: 'POST',
        body: { titular: sub.titular, substituto: sub.substituto, from: sub.from, until: sub.until },
      });
      setSubs(prev => [...prev, saved]);
    } catch (e) {
      setSubError(friendlyError(e));
    }
  }

  // ─── EDIÇÃO DE ESCALA (ADMIN) ─────────────────────────────────────────────

  function toggleEditMode() {
    setEditMode(e => !e);
    setSelectedShifts(new Set());
    setEditError(null);
    setEditForm({ persons: [], period: '', time: '', dur: '' });
    setApplyToFuture(false);
    setAddDay(null);
  }

  const togglePerson = (list, name) =>
    list.includes(name) ? list.filter(p => p !== name) : [...list, name];

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

  function buildBasePatch(useForm) {
    const basePatch = {};
    for (const key of selectedShifts) {
      const lastDash = key.lastIndexOf('-');
      const dk = key.slice(0, lastDash);
      const idx = key.slice(lastDash + 1);
      if (!basePatch[dk]) basePatch[dk] = {};
      if (useForm) {
        const override = {};
        if (editForm.persons.length) override.persons = editForm.persons;
        if (editForm.period)         override.period  = editForm.period;
        if (editForm.time)           override.time    = editForm.time;
        if (editForm.dur)            override.dur     = editForm.dur;
        basePatch[dk][idx] = Object.keys(override).length ? override : null;
      } else {
        basePatch[dk][idx] = null;
      }
    }
    return basePatch;
  }

  async function postPatch(patch, clearForm) {
    setEditSaving(true);
    setEditError(null);
    try {
      const updated = await api('/api/schedule', { method: 'POST', body: { overrides: patch } });
      setOverrides(updated.overrides || {});
      setLabels(updated.labels || {});
      setSelectedShifts(new Set());
      if (clearForm) setEditForm({ persons: [], period: '', time: '', dur: '' });
      setApplyToFuture(false);
    } catch (e) {
      setEditError(friendlyError(e));
    } finally {
      setEditSaving(false);
    }
  }

  // Adiciona um turno NOVO ao dia (índice = próximo livre). Requer pessoas + horário.
  async function addShift() {
    if (!addDay || editSaving) return;
    if (!addForm.persons.length || !addForm.time || !addForm.period) {
      setEditError('Preencha período, horário e ao menos uma pessoa.');
      return;
    }
    const day = schedule.find(d => dayKey(d.date) === addDay);
    const nextIdx = day ? day.shifts.reduce((mx, s) => Math.max(mx, s.idx), -1) + 1 : 0;
    setEditSaving(true);
    setEditError(null);
    try {
      const body = { overrides: { [addDay]: { [nextIdx]: {
        persons: addForm.persons, period: addForm.period, time: addForm.time, dur: addForm.dur || '',
      } } } };
      const updated = await api('/api/schedule', { method: 'POST', body });
      setOverrides(updated.overrides || {});
      setLabels(updated.labels || {});
      setAddDay(null);
      setAddForm({ persons: [], period: '', time: '', dur: '' });
    } catch (e) {
      setEditError(friendlyError(e));
    } finally {
      setEditSaving(false);
    }
  }

  // Salva/remove o rótulo do dia (ex.: "Feriado"). value vazio remove.
  async function saveDayLabel(dk, value) {
    const v = value.trim();
    if ((labels[dk] || '') === v) return; // sem mudança
    setLabels(prev => { const n = { ...prev }; if (v) n[dk] = v; else delete n[dk]; return n; });
    try {
      const updated = await api('/api/schedule', { method: 'POST', body: { labels: { [dk]: v || null } } });
      setOverrides(updated.overrides || {});
      setLabels(updated.labels || {});
    } catch (e) {
      setEditError(friendlyError(e));
    }
  }

  function applyEditOverrides() {
    if (!selectedShifts.size || editSaving) return;
    if (applyToFuture) { setConfirmAction('apply'); return; }
    postPatch(buildBasePatch(true), true);
  }

  function resetSelectedShifts() {
    if (!selectedShifts.size || editSaving) return;
    if (applyToFuture) { setConfirmAction('reset'); return; }
    postPatch(buildBasePatch(false), false);
  }

  function confirmPendingAction() {
    const action = confirmAction;
    setConfirmAction(null);
    const useForm = action === 'apply';
    const base = buildBasePatch(useForm);
    postPatch(expandPatchToFuture(base), useForm);
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

  const T = getTheme(dark);

  const selStyle = {
    display:"block", width:"100%", padding:"0.5rem 0.6rem", fontSize:"0.85rem", minHeight:"2.5rem",
    borderRadius:"0.4rem", border:`1px solid ${T.inputBorder}`,
    background:T.inputBg, color:T.textPrimary, marginTop:"0.25rem",
  };

  const labelStyle = { fontSize:"0.72rem", fontWeight:600, color:T.labelColor };

  const scheduleReady = !overridesLoading;

  return (
    <div style={{ minHeight:"100vh", background:T.pageBg, fontFamily:"'Segoe UI',system-ui,sans-serif", color:T.textPrimary, transition:"background 0.2s,color 0.2s" }}>
      <div className="max-w-3xl mx-auto px-4 py-6">

        {/* CABEÇALHO */}
        <header className="rounded-2xl p-5 mb-5 text-white" style={{ background:T.headerGrad, position:"relative" }}>
          <button
            onClick={onToggleDark}
            aria-label={dark ? "Mudar para tema claro" : "Mudar para tema escuro"}
            style={{ position:"absolute", top:"0.6rem", right:"0.6rem", zIndex:2, display:"inline-flex", alignItems:"center", gap:"0.35rem", background:"rgba(255,255,255,0.12)", color:"#fff", border:"1px solid rgba(255,255,255,0.22)", borderRadius:"9999px", padding:"0.5rem 0.85rem", minHeight:"2.75rem", fontSize:"0.72rem", fontWeight:"600", cursor:"pointer", letterSpacing:"0.02em" }}
          >
            <Icon name={dark ? "sun" : "moon"} size={14} />
            {dark ? "Claro" : "Escuro"}
          </button>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-sm font-semibold opacity-80 mb-1" style={{ letterSpacing:"0.01em" }}>Escala de Sobreaviso</h1>
              <div className="text-2xl font-bold">{DOW[now.getDay()]}, {fmtDate(now)}/{now.getFullYear()}</div>
            </div>
            <div className="rounded-xl px-4 py-3 min-w-[200px]" style={{ background:"rgba(255,255,255,0.08)", borderLeft:`4px solid ${scheduleReady ? onCallColor : "rgba(255,255,255,0.25)"}` }}>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider opacity-80">
                <span className="relative flex w-2 h-2">
                  <span className="animate-ping motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background:scheduleReady ? onCallColor : "#94A3B8" }} />
                  <span className="relative inline-flex rounded-full w-2 h-2" style={{ background:scheduleReady ? onCallColor : "#94A3B8" }} />
                </span>
                Agora
              </div>
              {!scheduleReady ? (
                <div role="status" aria-label="Carregando escala">
                  <Skeleton w="8rem" h="1.35rem" T={{ skeletonBg:"rgba(255,255,255,0.18)" }} style={{ margin:"0.35rem 0 0.3rem" }} />
                  <Skeleton w="11rem" h="0.8rem" T={{ skeletonBg:"rgba(255,255,255,0.12)" }} />
                </div>
              ) : onCall ? (
                <>
                  <div className="text-lg font-bold leading-tight" style={{ color: onCallColor === "#37474F" ? "#CBD5E1" : onCallColor }}>
                    {onCall.people.map(p => p.person).join(" · ")}
                  </div>
                  <div className="text-xs opacity-80">
                    {onCall.label} · {onCall.time}
                    {onCall.people.some(p => p.coveringFor) && (
                      <span className="ml-1">· cobre {onCall.people.filter(p => p.coveringFor).map(p => p.coveringFor).join(", ")}</span>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-lg font-bold opacity-90">Sem sobreaviso</div>
                  <div className="text-xs opacity-80">Horário comercial (09:00 – 18:00)</div>
                </>
              )}

              {/* Handoff: plantonista anterior e próximo */}
              {scheduleReady && (handoff.anterior || handoff.proximo) && (
                <>
                  <div style={{ height:1, background:"rgba(255,255,255,0.12)", margin:"0.7rem 0 0.15rem" }} />
                  {[
                    { label:"antes",  data:handoff.anterior, prefix:"até " },
                    { label:"depois", data:handoff.proximo,  prefix:"" },
                  ].map(({ label, data, prefix }) => (
                    <div key={label} style={{ display:"flex", alignItems:"center", gap:"0.5rem", fontSize:"0.8rem", marginTop:"0.4rem" }}>
                      <span style={{ width:"3rem", flex:"none", fontSize:"0.7rem", color:"rgba(255,255,255,0.5)" }}>{label}</span>
                      {data ? (
                        <>
                          <span style={{ width:8, height:8, borderRadius:"50%", flex:"none", background: data.people.length === 1 ? ((PEOPLE[data.people[0]]||{}).color||"#94A3B8") : "#94A3B8", boxShadow:"0 0 0 1px rgba(255,255,255,0.15)" }} />
                          <span style={{ fontWeight:600, color:"#E2E8F0" }}>{data.people.join(" / ")}</span>
                          <span style={{ color:"rgba(255,255,255,0.55)" }}>· {prefix}{data.hora}</span>
                        </>
                      ) : (
                        <span style={{ color:"rgba(255,255,255,0.4)" }}>—</span>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </header>

        {overridesError && (
          <div role="alert" className="rounded-xl px-4 py-3 mb-4 flex items-center justify-between gap-3 flex-wrap"
            style={{ background:"rgba(245,158,11,0.12)", border:`1px solid ${WARN}` }}>
            <span className="flex items-center gap-2 text-sm font-semibold" style={{ color:WARN }}>
              <Icon name="alert" size={16} />
              Não foi possível carregar as edições da escala — mostrando a escala base.
            </span>
            <button onClick={loadOverrides}
              style={{ background:"transparent", border:`1px solid ${WARN}`, color:WARN, borderRadius:"9999px", padding:"0.35rem 0.9rem", fontSize:"0.75rem", fontWeight:700, cursor:"pointer", minHeight:"2.25rem" }}>
              Tentar de novo
            </button>
          </div>
        )}

        {/* FILTRO */}
        <section className="mb-4" aria-label="Filtro por responsável">
          <h2 className="text-sm font-semibold mb-2" style={{ color:T.textSecondary }}>Filtrar por responsável</h2>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => { setFilter(null); saveProfile({ filter: null }); }} className="px-3.5 rounded-full text-sm font-bold transition-all"
              style={{ minHeight:"2.5rem", background:!filter?T.filterAllBg:T.filterDefBg, color:!filter?T.filterAllColor:T.filterDefColor, border:"1.5px solid "+(!filter?T.filterAllBorder:T.filterDefBorder) }}>
              Todos
            </button>
            {Object.entries(PEOPLE).map(([name, p]) => {
              const temSubHoje = activeTitulares.has(name);
              return (
                <button key={name} onClick={() => handleFilterChange(name)} className="px-3.5 rounded-full text-sm font-bold transition-all inline-flex items-center gap-1.5"
                  aria-pressed={filter === name}
                  style={{ minHeight:"2.5rem", background:filter===name?p.color:T.filterDefBg, color:filter===name?"#fff":p.color, border:`1.5px solid ${filter===name?p.color:T.filterDefBorder}` }}>
                  {name}
                  {temSubHoje && <Icon name="umbrella" size={13} />}
                </button>
              );
            })}
          </div>
          {activeTitulares.size > 0 && (
            <p className="flex items-center gap-1.5 text-xs mt-2" style={{ color:T.textMuted }}>
              <Icon name="umbrella" size={12} /> = com substituição ativa hoje (ausente, coberto por outra pessoa)
            </p>
          )}
        </section>

        {/* PRÓXIMOS PLANTÕES */}
        {filter && (
          <section className="rounded-2xl p-4 mb-5" style={{ background:T.cardBg, border:`1px solid ${T.cardBorder}` }}>
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
                    style={{ borderTop: i>0?`1px solid ${T.divider}`:"none", opacity: u.coveredBy ? 0.5 : 1 }}>
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-mono font-bold w-14" style={{ color:T.textSecondary }}>{fmtDate(u.date)}</span>
                      <span className="w-10" style={{ color:T.textMuted }}>{DOW_SHORT[u.dow]}</span>
                      {u.kind === "folga" ? (
                        <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold" style={{ background:"#FEF9C3", color:"#854D0E" }}>
                          <Icon name="umbrella" size={12} /> Folga FDS
                        </span>
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
          </section>
        )}

        {/* NAVEGAÇÃO DE MESES + BOTÃO DE EDIÇÃO (admin) */}
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 min-w-0 rounded-xl px-3 py-1.5" style={{ background:T.cardBg, border:`1px solid ${editMode ? ACCENT : T.cardBorder}` }}>
            <div className="flex gap-2 overflow-x-auto items-center" style={{ scrollbarWidth:"thin", scrollbarColor:`${T.cardBorder} transparent` }}>
              <button onClick={goToToday} className="px-3 rounded-lg text-sm font-bold whitespace-nowrap transition-all flex-shrink-0"
                style={{ minHeight:"2.5rem", background:"transparent", color:ACCENT, border:`1px solid ${ACCENT}` }}>
                Hoje
              </button>
              {months.map(m => (
                <button key={m.key} onClick={() => handleMonthChange(m.key)} className="px-3 rounded-lg text-sm font-bold whitespace-nowrap transition-all flex-shrink-0"
                  aria-current={activeMonth === m.key ? 'true' : undefined}
                  style={{ minHeight:"2.5rem", background:activeMonth===m.key?T.monthActiveBg:T.monthDefBg, color:activeMonth===m.key?T.monthActiveColor:T.monthDefColor, border:"1px solid "+(activeMonth===m.key?T.monthActiveBorder:T.monthDefBorder) }}>
                  {MONTHS_SHORT[m.m]}/{String(m.y).slice(2)}
                </button>
              ))}
            </div>
          </div>
          {isAdmin && (
            <button
              onClick={toggleEditMode}
              style={{ flexShrink:0, display:"inline-flex", alignItems:"center", gap:"0.35rem", background: editMode ? ACCENT : T.cardBg, color: editMode ? '#fff' : T.textSecondary, border:`1px solid ${editMode ? ACCENT : T.cardBorder}`, borderRadius:"0.75rem", padding:"0.5rem 0.85rem", minHeight:"2.75rem", fontSize:"0.75rem", fontWeight:"700", cursor:"pointer", whiteSpace:"nowrap" }}
            >
              <Icon name={editMode ? "x" : "pencil"} size={14} />
              {editMode ? 'Sair da edição' : 'Editar Escala'}
            </button>
          )}
        </div>

        {/* CALENDÁRIO */}
        <h2 className="font-bold text-lg mb-2" style={{ color:T.textPrimary }}>{am?`${MONTHS[am.m]} de ${am.y}`:""}</h2>
        {!scheduleReady ? (
          <div className="space-y-2 pb-4" role="status" aria-label="Carregando calendário">
            {[0,1,2,3].map(i => <Skeleton key={i} h="4.5rem" T={T} style={{ borderRadius:"0.75rem" }} />)}
          </div>
        ) : (
        <div className="space-y-2 pb-4">
          {monthDays.map(d => {
            const isToday   = sameDay(d.date, now);
            const isWeekend = d.dow === 0 || d.dow === 6;
            const isPast    = !isToday && d.date < now;
            const dk        = dayKey(d.date);
            const hasFiltered = !filter || d.shifts.some(s => shiftPeople(s).some(p => {
              const sub = getActiveSub(p, dk, subs);
              return (sub ? sub.substituto : p) === filter || p === filter;
            })) || d.folga === filter;
            return (
              <div key={dayKey(d.date)} ref={isToday ? todayRef : null} className="rounded-xl overflow-hidden"
                style={{ scrollMarginTop:'64px', border:`${isToday?2:1}px solid ${isToday?T.cardBorderToday:T.cardBorder}`, opacity: isPast?0.45:filter&&!hasFiltered?0.35:1, background:isWeekend?T.cardBgWeekend:T.cardBg }}>
                <div className="flex items-stretch">
                  <div className="flex flex-col items-center justify-center w-16 shrink-0 py-3"
                    style={{ background:isWeekend?T.dateColBgWeekend:T.dateColBg, borderRight:`1px solid ${T.dateColBorder}` }}>
                    <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color:T.textMuted }}>{DOW_SHORT[d.dow]}</div>
                    <div className="text-xl font-bold leading-tight" style={{ color:T.dateNumColor }}>{String(d.date.getDate()).padStart(2,"0")}</div>
                    <div className="text-[10px] font-semibold" style={{ color:T.monthShortColor }}>{MONTHS_SHORT[d.date.getMonth()]}</div>
                    {isToday && <div className="mt-1 text-[9px] font-bold text-white bg-slate-800 rounded px-1.5 py-0.5">HOJE</div>}
                  </div>
                  <div className="flex-1 px-3 py-2">
                    {(d.label || (editMode && isAdmin)) && (
                      <div className="flex flex-wrap items-center gap-2 mb-1.5">
                        {d.label && !editMode && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold rounded px-1.5 py-0.5" style={{ background:"rgba(99,102,241,0.15)", color:"#A5B4FC" }}>
                            <Icon name="umbrella" size={10} /> {d.label}
                          </span>
                        )}
                        {editMode && isAdmin && (
                          <input
                            key={`${dk}-${d.label || ''}`}
                            defaultValue={d.label || ''}
                            placeholder="rótulo do dia (ex.: Feriado)"
                            onBlur={e => saveDayLabel(dk, e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                            style={{ fontSize:'0.72rem', background:T.inputBg, color:T.textPrimary, border:`1px solid ${T.inputBorder}`, borderRadius:'0.4rem', padding:'0.3rem 0.5rem', minHeight:'2.25rem', maxWidth:'13rem' }}
                          />
                        )}
                      </div>
                    )}
                    {isWeekend && d.dow === 6 && (
                      <div className="flex flex-wrap items-center gap-2 mb-1.5">
                        <span className="text-[10px] font-bold rounded px-1.5 py-0.5" style={{ background:T.cycleBg, color:T.cycleColor }}>
                          Semana {d.cycleWeek} do ciclo
                        </span>
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold rounded px-1.5 py-0.5" style={{ background:"#FEF9C3", color:"#854D0E", opacity: filter&&d.folga!==filter?0.4:1 }}>
                          <Icon name="umbrella" size={11} /> Folga FDS: {d.folga}
                        </span>
                      </div>
                    )}
                    <div className="space-y-0.5">
                      {d.shifts.map((s) => {
                        const i = s.idx; // índice estável do override (não a posição no array)
                        const people = shiftPeople(s).map(titular => {
                          const sub = getActiveSub(titular, dk, subs);
                          return { person: sub ? sub.substituto : titular, subOf: sub ? titular : null, titular };
                        });
                        const dim = !!(filter && !people.some(p => p.person === filter || p.titular === filter));
                        const shiftKey = `${dk}-${i}`;
                        const isSelected = selectedShifts.has(shiftKey);
                        const ov = overrides[dk]?.[String(i)];
                        const hasOverride = !!ov;
                        const recent = ov?.editedAt ? (now.getTime() - Date.parse(ov.editedAt)) < EDIT_RECENT_MS : false;
                        // Fora do modo edição: só destaca o que mudou recentemente.
                        // No modo edição: destaca todos os overrides (o admin gerencia customizações).
                        const highlight = editMode ? hasOverride : recent;
                        const shiftProps = editMode ? {
                          role: 'checkbox',
                          'aria-checked': isSelected,
                          'aria-label': `${DOW_SHORT[d.dow]} ${fmtDate(d.date)} · ${s.period} ${s.time} · ${people.map(p => p.person).join(', ')}`,
                          tabIndex: 0,
                          onClick: () => toggleShift(dk, i),
                          onKeyDown: (e) => {
                            if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleShift(dk, i); }
                          },
                        } : {};
                        return (
                          <div key={i}
                            {...shiftProps}
                            className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm"
                            style={{
                              opacity: dim ? 0.3 : 1,
                              cursor: editMode ? 'pointer' : 'default',
                              background: isSelected ? 'rgba(99,102,241,0.12)' : 'transparent',
                              borderRadius: '0.375rem',
                              padding: editMode ? '0.45rem 0.35rem' : '0.1rem 0',
                              outline: isSelected ? `1.5px solid ${ACCENT}` : undefined,
                              margin: editMode ? '0.05rem 0' : undefined,
                            }}>
                            {editMode && (
                              <span aria-hidden="true" style={{ width:'1rem', height:'1rem', borderRadius:'3px', border:`1.5px solid ${isSelected?ACCENT:T.cardBorder}`, background:isSelected?ACCENT:'transparent', display:'inline-flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                {isSelected && <Icon name="check" size={11} style={{ color:'#fff' }} />}
                              </span>
                            )}
                            <span className="w-24 font-semibold" style={{ color: highlight ? '#818CF8' : T.textSecondary }}>{s.period}</span>
                            <span className="font-mono text-xs w-28" style={{ color: highlight ? '#818CF8' : T.textMuted }}>{s.time}</span>
                            <span className="font-mono text-xs w-7" style={{ color:T.textMuted }}>{s.dur}</span>
                            <span className="inline-flex flex-wrap items-center gap-1">
                              {people.map((p, pi) => <PersonTag key={pi} name={p.person} subOf={p.subOf} />)}
                            </span>
                            {recent ? (
                              <span title={`Alterado em ${fmtEdited(ov.editedAt)}`} style={{ fontSize:'0.6rem', color:'#818CF8', fontWeight:'700', background:'rgba(99,102,241,0.1)', borderRadius:'3px', padding:'0 4px' }}>
                                alterado {fmtEdited(ov.editedAt)}
                              </span>
                            ) : (editMode && hasOverride) ? (
                              <span style={{ fontSize:'0.6rem', color:T.textMuted, fontWeight:'700', background:'rgba(148,163,184,0.12)', borderRadius:'3px', padding:'0 4px' }}>editado</span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>

                    {/* Adicionar turno ao dia (admin, modo edição) */}
                    {editMode && isAdmin && (addDay === dk ? (
                      <div className="mt-2 pt-2" style={{ borderTop:`1px dashed ${T.cardBorder}` }}>
                        <div className="grid gap-2 mb-2" style={{ gridTemplateColumns:'repeat(auto-fit, minmax(120px, 1fr))' }}>
                          <input value={addForm.period} onChange={e => setAddForm(f => ({ ...f, period:e.target.value }))} placeholder="Período (ex: Tarde)" style={{ ...selStyle, marginTop:0 }} />
                          <input value={addForm.time} onChange={e => setAddForm(f => ({ ...f, time:e.target.value }))} placeholder="Horário (ex: 17:00 – 23:00)" style={{ ...selStyle, marginTop:0 }} />
                          <input value={addForm.dur} onChange={e => setAddForm(f => ({ ...f, dur:e.target.value }))} placeholder="Duração (ex: 6h)" style={{ ...selStyle, marginTop:0 }} />
                        </div>
                        <div className="mb-2"><PersonPicker selected={addForm.persons} onToggle={n => setAddForm(f => ({ ...f, persons: togglePerson(f.persons, n) }))} /></div>
                        <div className="flex gap-2">
                          <button onClick={addShift} disabled={editSaving}
                            style={{ background:ACCENT, color:'#fff', border:'none', borderRadius:'0.5rem', padding:'0.4rem 0.9rem', minHeight:'2.5rem', fontWeight:700, fontSize:'0.78rem', cursor:editSaving?'not-allowed':'pointer' }}>
                            {editSaving ? 'Salvando…' : 'Adicionar turno'}
                          </button>
                          <button onClick={() => { setAddDay(null); setEditError(null); }}
                            style={{ background:'transparent', color:T.textMuted, border:`1px solid ${T.cardBorder}`, borderRadius:'0.5rem', padding:'0.4rem 0.9rem', minHeight:'2.5rem', fontWeight:700, fontSize:'0.78rem', cursor:'pointer' }}>
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => { setAddDay(dk); setAddForm({ persons: [], period: '', time: '', dur: '' }); setEditError(null); }}
                        className="mt-1.5 inline-flex items-center gap-1"
                        style={{ background:'transparent', color:T.textMuted, border:`1px dashed ${T.cardBorder}`, borderRadius:'0.5rem', padding:'0.35rem 0.7rem', minHeight:'2.25rem', fontSize:'0.72rem', fontWeight:700, cursor:'pointer' }}>
                        <Icon name="plus" size={12} /> Adicionar turno
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        )}

        {/* SUBSTITUIÇÕES */}
        <section className="rounded-2xl p-4 mt-4" style={{ background:T.cardBg, border:`1px solid ${T.cardBorder}` }}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold" style={{ color:T.textSecondary }}>Substituições</h2>
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
                style={{ display:"inline-flex", alignItems:"center", gap:"0.3rem", background:"transparent", border:`1px solid ${T.cardBorder}`, borderRadius:"9999px", padding:"0.4rem 0.85rem", minHeight:"2.5rem", fontSize:"0.75rem", fontWeight:"700", cursor:"pointer", color:T.textSecondary }}
              >
                {subForm.show ? <><Icon name="x" size={13} /> Cancelar</> : <><Icon name="plus" size={13} /> Adicionar</>}
              </button>
            )}
          </div>

          {subError && (
            <p role="alert" className="flex items-center gap-1.5 text-xs font-semibold mb-2" style={{ color:DANGER }}>
              <Icon name="alert" size={13} /> {subError}
            </p>
          )}

          {monthSubs.length === 0 && !subForm.show && !subsLoading && (
            <div className="text-xs" style={{ color:T.textMuted }}>Nenhuma substituição neste mês. Use para férias ou trocas eventuais.</div>
          )}
          {subsLoading && <div className="text-xs" role="status" style={{ color:T.textMuted }}>Carregando substituições…</div>}

          {monthSubs.map((s) => {
            // Show delete only to admin, or to member if they appear in the substitution
            const canDelete = isAdmin
              || (profile?.role === 'member' && (s.titular === profile?.memberId || s.substituto === profile?.memberId));
            return (
              <div key={s.id} className="flex items-center justify-between py-1.5 flex-wrap gap-y-1"
                style={{ borderTop: `1px solid ${T.divider}` }}>
                <div className="flex items-center gap-2 flex-wrap text-sm">
                  <PersonTag name={s.titular} />
                  <span aria-hidden="true" style={{ color:T.textMuted, fontSize:"1rem" }}>→</span>
                  <PersonTag name={s.substituto} />
                  <span className="text-xs font-mono" style={{ color:T.textMuted }}>{fmtDS(s.from)} – {fmtDS(s.until)}</span>
                </div>
                {canDelete && (
                  <button onClick={() => removeSub(s)}
                    aria-label={`Excluir substituição: ${s.substituto} cobre ${s.titular} de ${fmtDS(s.from)} a ${fmtDS(s.until)}`}
                    style={{ background:"transparent", border:"none", cursor:"pointer", color:T.textMuted, display:"inline-flex", alignItems:"center", justifyContent:"center", width:"2.75rem", height:"2.75rem", borderRadius:"0.5rem", flexShrink:0 }}>
                    <Icon name="x" size={16} />
                  </button>
                )}
              </div>
            );
          })}

          {subForm.show && (
            <div className="mt-3 pt-3" style={{ borderTop:`1px solid ${T.cardBorder}` }}>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label style={labelStyle}>Titular (ausente)
                  <select value={subForm.titular} onChange={e => setSubForm(f => ({ ...f, titular:e.target.value, substituto: f.substituto===e.target.value?"":f.substituto }))} style={selStyle}>
                    <option value="">Selecionar…</option>
                    {Object.keys(PEOPLE).map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  </label>
                </div>
                <div>
                  <label style={labelStyle}>Substituto
                  <select value={subForm.substituto} onChange={e => setSubForm(f => ({ ...f, substituto:e.target.value }))} style={selStyle}>
                    <option value="">Selecionar…</option>
                    {Object.keys(PEOPLE).filter(p => p !== subForm.titular).map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  </label>
                </div>
                <div>
                  <label style={labelStyle}>De
                  <input type="date" value={subForm.from} onChange={e => setSubForm(f => ({ ...f, from:e.target.value }))} style={selStyle} />
                  </label>
                </div>
                <div>
                  <label style={labelStyle}>Até
                  <input type="date" value={subForm.until} onChange={e => setSubForm(f => ({ ...f, until:e.target.value }))} style={selStyle} />
                  </label>
                </div>
              </div>
              <button onClick={addSub} disabled={!canSave || subSaving}
                style={{ background:canSave&&!subSaving?T.saveBg:T.cardBorder, color:canSave&&!subSaving?T.saveColor:T.textMuted, border:"none", borderRadius:"0.5rem", padding:"0.5rem 1.1rem", minHeight:"2.75rem", fontWeight:"700", fontSize:"0.8rem", cursor:canSave&&!subSaving?"pointer":"not-allowed", transition:"background 0.15s" }}>
                {subSaving ? "Salvando…" : "Salvar substituição"}
              </button>

              {coverSuggestions.length > 0 && (
                <div className="mt-4 pt-3" style={{ borderTop:`1px solid ${T.divider}` }}>
                  <h3 className="text-xs font-semibold mb-2" style={{ color:T.labelColor }}>
                    {subForm.substituto
                      ? `${subForm.substituto} cobrirá ${coverSuggestions.length} dia${coverSuggestions.length>1?"s":""} de ${subForm.titular || "…"}`
                      : `${coverSuggestions.length} dia${coverSuggestions.length>1?"s":""} a cobrir — quem está livre`}
                  </h3>
                  <div>
                    {coverSuggestions.slice(0, 12).map((day, i) => (
                      <div key={i} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 text-xs py-1.5"
                        style={{ borderTop: i > 0 ? `1px solid ${T.divider}` : "none" }}>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold" style={{ color:T.textSecondary }}>{fmtDate(day.date)}</span>
                          <span style={{ color:T.textMuted }}>{DOW_SHORT[day.dow]}</span>
                          <span style={{ color:T.textSecondary }}>{day.shifts.map(s => s.period).join(" + ")}</span>
                          <span style={{ color:T.textMuted }}>{day.shifts.map(s => s.time).join(" / ")}</span>
                        </div>
                        {!subForm.substituto && (
                          <span className="inline-flex items-center gap-1" style={{ color: day.available.length ? T.textSecondary : DANGER }}>
                            {day.available.length ? `Livres: ${day.available.join(", ")}` : <><Icon name="alert" size={12} /> Todos ocupados</>}
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
        </section>

        {/* PAINEL DE EDIÇÃO (admin, sticky na parte inferior) */}
        {isAdmin && editMode && (
          <div style={{ position:'sticky', bottom:'1rem', marginTop:'1rem', background:T.cardBg, border:`1.5px solid ${selectedShifts.size ? ACCENT : T.cardBorder}`, borderRadius:'1rem', padding:'1rem', boxShadow:'0 8px 32px rgba(0,0,0,0.35)', zIndex:40 }}>
            <div className="flex items-center justify-between mb-3">
              <span style={{ fontWeight:700, fontSize:'0.875rem', color:T.textPrimary }} role="status">
                {selectedShifts.size === 0
                  ? 'Toque nos turnos do calendário para selecioná-los'
                  : `${selectedShifts.size} turno${selectedShifts.size > 1 ? 's' : ''} selecionado${selectedShifts.size > 1 ? 's' : ''}`}
              </span>
              {selectedShifts.size > 0 && (
                <button onClick={() => setSelectedShifts(new Set())} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'0.78rem', color:T.textMuted, padding:'0.5rem', minHeight:'2.5rem' }}>
                  Limpar seleção
                </button>
              )}
            </div>

            {selectedShifts.size > 0 && (
              <>
                <div className="mb-3">
                  <div style={labelStyle}>Pessoas <span style={{ fontWeight:400, color:T.textMuted }}>(vazio = manter as atuais)</span></div>
                  <div className="mt-1">
                    <PersonPicker selected={editForm.persons} onToggle={n => setEditForm(f => ({ ...f, persons: togglePerson(f.persons, n) }))} />
                  </div>
                </div>
                <div className="grid gap-3 mb-3" style={{ gridTemplateColumns:'repeat(auto-fit, minmax(130px, 1fr))' }}>
                  <div>
                    <label style={labelStyle}>Período
                    <input value={editForm.period} onChange={e => setEditForm(f => ({ ...f, period:e.target.value }))}
                      placeholder="ex: Madrugada" style={selStyle} />
                    </label>
                  </div>
                  <div>
                    <label style={labelStyle}>Horário
                    <input value={editForm.time} onChange={e => setEditForm(f => ({ ...f, time:e.target.value }))}
                      placeholder="ex: 23:00 – 04:00" style={selStyle} />
                    </label>
                  </div>
                  <div>
                    <label style={labelStyle}>Duração
                    <input value={editForm.dur} onChange={e => setEditForm(f => ({ ...f, dur:e.target.value }))}
                      placeholder="ex: 5h" style={selStyle} />
                    </label>
                  </div>
                </div>

                {/* Toggle: apply to all future months */}
                <label style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.75rem', cursor:'pointer', userSelect:'none', minHeight:'2.5rem' }}>
                  <input
                    type="checkbox"
                    checked={applyToFuture}
                    onChange={e => setApplyToFuture(e.target.checked)}
                    style={{ width:'1.1rem', height:'1.1rem', cursor:'pointer', accentColor:ACCENT }}
                  />
                  <span style={{ fontSize:'0.8rem', fontWeight:'600', color: applyToFuture ? '#A5B4FC' : T.textSecondary }}>
                    Aplicar a todos os meses seguintes
                  </span>
                  {applyToFuture && futureShiftCount > 0 && (
                    <span style={{ fontSize:'0.72rem', fontWeight:'700', background:'rgba(245,158,11,0.15)', color:WARN, borderRadius:'9999px', padding:'0.1rem 0.5rem' }}>
                      {futureShiftCount} turno{futureShiftCount > 1 ? 's' : ''}
                    </span>
                  )}
                </label>
                {applyToFuture && (
                  <p className="flex items-center gap-1.5" style={{ fontSize:'0.72rem', color:WARN, fontWeight:'600', margin:'0 0 0.75rem 0' }}>
                    <Icon name="alert" size={13} /> Mudança permanente — afeta todos os meses até o fim da escala
                  </p>
                )}

                <div className="flex flex-wrap gap-2 items-center">
                  <button onClick={applyEditOverrides} disabled={editSaving}
                    style={{ background:editSaving?T.cardBorder:ACCENT, color:'#fff', border:'none', borderRadius:'0.5rem', padding:'0.5rem 1rem', minHeight:'2.75rem', fontWeight:700, fontSize:'0.8rem', cursor:editSaving?'not-allowed':'pointer' }}>
                    {editSaving ? 'Salvando…' : applyToFuture ? `Aplicar a ${futureShiftCount} turnos` : 'Aplicar alteração'}
                  </button>
                  <button onClick={resetSelectedShifts} disabled={editSaving}
                    style={{ background:'transparent', color:DANGER, border:`1px solid ${DANGER}`, borderRadius:'0.5rem', padding:'0.5rem 0.85rem', minHeight:'2.75rem', fontWeight:700, fontSize:'0.8rem', cursor:editSaving?'not-allowed':'pointer' }}>
                    {applyToFuture ? `Resetar ${futureShiftCount} turnos` : 'Resetar para padrão'}
                  </button>
                </div>
                {editError && (
                  <p role="alert" className="flex items-center gap-1.5" style={{ color:DANGER, fontSize:'0.75rem', fontWeight:600, marginTop:'0.5rem' }}>
                    <Icon name="alert" size={13} /> {editError}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        <footer className="mt-4 text-center text-xs" style={{ color:T.footerText }}>
          Ciclo de fim de semana ancorado em 13/06/2026 (Semana 1) · Escala seg–sex fixa · 5 semanas de rotação
        </footer>
      </div>

      <Snackbar
        open={!!undoSub}
        message={undoSub ? `Substituição de ${undoSub.titular} removida` : ''}
        actionLabel="Desfazer"
        onAction={undoRemoveSub}
        T={T}
      />

      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction === 'reset' ? `Resetar ${futureShiftCount} turnos?` : `Aplicar alteração a ${futureShiftCount} turnos?`}
        body={confirmAction === 'reset'
          ? 'Isso remove as edições feitas nesses turnos em todos os meses seguintes e restaura a escala padrão. Essa ação não pode ser desfeita.'
          : 'A alteração será aplicada a todos os meses seguintes, até o fim da escala. Ela pode ser revertida turno a turno com "Resetar para padrão".'}
        confirmLabel={confirmAction === 'reset' ? `Resetar ${futureShiftCount} turnos` : `Aplicar a ${futureShiftCount} turnos`}
        cancelLabel="Cancelar"
        onConfirm={confirmPendingAction}
        onCancel={() => setConfirmAction(null)}
        T={T}
      />
    </div>
  );
}
