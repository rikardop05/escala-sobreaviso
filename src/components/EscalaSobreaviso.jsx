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

  const [now,      setNow]      = useState(new Date());
  const [filter,   setFilter]   = useState(profile?.filter ?? null);
  const [monthKey, setMonthKey] = useState(profile?.monthKey ?? null);
  const [subs,     setSubs]     = useState([]);
  const [subForm,  setSubForm]  = useState({ show: false, titular: "", substituto: "", from: "", until: "" });
  const [subsLoading, setSubsLoading] = useState(true);
  const [subSaving,   setSubSaving]   = useState(false);
  const [subError,    setSubError]    = useState(null);
  const todayRef = useRef(null);

  // Carrega substituições do servidor
  useEffect(() => {
    api('/api/substitutions')
      .then(data => setSubs(data || []))
      .catch(console.error)
      .finally(() => setSubsLoading(false));
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

  const schedule = useMemo(() => buildSchedule(), []);
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

  const onCallBase = currentOnCall(now);
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
      console.error('Erro ao salvar substituição:', e);
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

  const fmtDate = (d) => `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
  const am = months.find(m => m.key === activeMonth);

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

        {/* SUBSTITUIÇÕES */}
        <div className="rounded-2xl p-4 mb-4" style={{ background:T.cardBg, border:`1px solid ${T.cardBorder}` }}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color:T.labelColor }}>Substituições</span>
              {subs.length > 0 && (
                <span className="text-[10px] font-bold rounded-full px-2 py-0.5" style={{ background:"#DBEAFE", color:"#1D4ED8" }}>
                  {subs.length} ativa{subs.length > 1 ? "s" : ""}
                </span>
              )}
            </div>
            <button
              onClick={subForm.show ? () => setSubForm(f => ({ ...f, show:false })) : openSubForm}
              style={{ background:"transparent", border:`1px solid ${T.cardBorder}`, borderRadius:"9999px", padding:"0.2rem 0.65rem", fontSize:"0.72rem", fontWeight:"700", cursor:"pointer", color:T.textSecondary }}
            >
              {subForm.show ? "Cancelar" : "+ Adicionar"}
            </button>
          </div>

          {subs.length === 0 && !subForm.show && !subsLoading && (
            <div className="text-xs" style={{ color:T.textMuted }}>Nenhuma substituição ativa. Use para férias ou trocas eventuais.</div>
          )}
          {subsLoading && <div className="text-xs" style={{ color:T.textMuted }}>Carregando...</div>}

          {subs.map((s, i) => (
            <div key={s.id} className="flex items-center justify-between py-2 flex-wrap gap-y-1"
              style={{ borderTop: i === 0 ? `1px solid ${T.upcomingDivider}` : `1px solid ${T.upcomingDivider}` }}>
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <PersonTag name={s.titular} />
                <span style={{ color:T.textMuted, fontSize:"1rem" }}>→</span>
                <PersonTag name={s.substituto} />
                <span className="text-xs font-mono" style={{ color:T.textMuted }}>{fmtDS(s.from)} – {fmtDS(s.until)}</span>
              </div>
              <button onClick={() => removeSub(s.id)}
                style={{ background:"transparent", border:"none", cursor:"pointer", color:T.textMuted, fontSize:"1rem", lineHeight:1, padding:"0 0.25rem" }}>
                ✕
              </button>
            </div>
          ))}

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

        {/* NAVEGAÇÃO DE MESES */}
        <div className="flex gap-2 overflow-x-auto pb-2 mb-3" style={{ scrollbarWidth:"thin" }}>
          {months.map(m => (
            <button key={m.key} onClick={() => handleMonthChange(m.key)} className="px-3 py-1.5 rounded-lg text-sm font-bold whitespace-nowrap transition-all"
              style={{ background:activeMonth===m.key?T.monthActiveBg:T.monthDefBg, color:activeMonth===m.key?T.monthActiveColor:T.monthDefColor, border:"1px solid "+(activeMonth===m.key?T.monthActiveBorder:T.monthDefBorder) }}>
              {MONTHS_SHORT[m.m]}/{String(m.y).slice(2)}
            </button>
          ))}
        </div>

        {/* CALENDÁRIO */}
        <h2 className="font-bold text-lg mb-3" style={{ color:T.textPrimary }}>{am?`${MONTHS[am.m]} de ${am.y}`:""}</h2>
        <div className="space-y-2">
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
                style={{ scrollMarginTop:'64px', border:`${isToday?2:1}px solid ${isToday?T.cardBorderToday:T.cardBorder}`, opacity: isPast?0.45:filter&&!hasFiltered?0.35:1, background:isWeekend?T.cardBgWeekend:T.cardBg }}>
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
                    <div className="space-y-1">
                      {d.shifts.map((s, i) => {
                        const sub = getActiveSub(s.person, dk, subs);
                        const effectivePerson = sub ? sub.substituto : s.person;
                        const dim = !!(filter && effectivePerson !== filter && s.person !== filter);
                        return (
                          <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm" style={{ opacity: dim?0.3:1 }}>
                            <span className="w-24 font-semibold" style={{ color:T.periodColor }}>{s.period}</span>
                            <span className="font-mono text-xs w-28" style={{ color:T.timeColor }}>{s.time}</span>
                            <span className="font-mono text-xs w-7" style={{ color:T.durColor }}>{s.dur}</span>
                            <PersonTag name={effectivePerson} subOf={sub ? s.person : null} />
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

        <div className="mt-6 text-center text-xs" style={{ color:T.textMuted }}>
          Ciclo de fim de semana ancorado em 13/06/2026 (Semana 1) · Escala seg–sex fixa · 5 semanas de rotação
        </div>
      </div>
    </div>
  );
}
