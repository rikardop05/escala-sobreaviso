import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useApi } from '../lib/api';
import {
  DOW, DOW_SHORT, MONTHS, MONTHS_SHORT,
  MS_DAY, dayKey, sameDay, fmtDS,
  buildSchedule, currentOnCall, adjacentOnCall,
  getActiveSub, getCoverSuggestions, shiftPeople, resolveShiftPeople, parseTimeRange,
  shiftDuration, sortShiftsByStart,
} from '../lib/schedule';
import { TEAMS, MEMBERS } from '../lib/teams';
import { getTheme, ACCENT, DANGER, WARN } from '../lib/theme';
import { Icon, Snackbar, ConfirmDialog, Skeleton, friendlyError } from './ui';

// Envio em lotes de overrides "aplicar a todos os meses seguintes" — propagar 1
// turno pelo range inteiro (~365 dias) gera ~30 KB, perto do limite de 50 KB do
// corpo da requisição (MAX_BODY_BYTES em api/_validate.js); 2 turnos estouram.
const PATCH_BATCH_DAYS = 150;

// Pessoas de TODAS as equipes (src/lib/teams.js) — cores/badges usadas em qualquer
// tela que possa mostrar gente de mais de uma equipe (o widget "Agora", em
// particular, sempre mostra as três). `PEOPLE` (schedule.js) cobre só a sustentação.
function PersonTag({ name, dim, subOf }) {
  const p = MEMBERS[name] || { color: "#555", bg: "#eee" };
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
// `roster` é a lista de nomes elegíveis — SEMPRE a equipe ativa, nunca todo mundo
// (um turno da sustentação não pode ser atribuído a alguém da infra).
function PersonPicker({ selected, onToggle, roster }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {roster.map(name => {
        const p = MEMBERS[name] || { color: "#555", bg: "#eee" };
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

// Equipe padrão ao abrir a tela, quando não há equipe no hash nem em teamView
// salvo (docs/specs/multi-equipe.md §5): a da própria pessoa; viewer/visitante
// sempre sustentação.
function defaultTeamId(profile) {
  if (!profile || profile.role === 'viewer') return 'sustentacao';
  if (profile.teamId && TEAMS[profile.teamId]) return profile.teamId;
  if (Array.isArray(profile.adminOf) && profile.adminOf.length) return profile.adminOf[0];
  return 'sustentacao';
}

// Lê a equipe do hash da URL (#escala/infra) — só quando é um id de equipe válido.
function hashTeam() {
  const m = window.location.hash.match(/^#escala\/([a-z]+)/);
  return m && TEAMS[m[1]] ? m[1] : null;
}

// Turno cujo início é >= dayStart da equipe (23:00 na sustentação) pertence ao
// dia anterior no calendário. Chame antes de "hoje" ou "01/07/2026" — datas de
// vigência são strings YYYY-MM-DD, comparam lexicograficamente sem problema.
function teamVigenciaMessage(team, dateStr) {
  if (team.startsOn && dateStr < team.startsOn) return `${team.nome} passa a existir em ${fmtDS(team.startsOn)}`;
  if (team.endsOn && dateStr > team.endsOn) return `${team.nome} encerrou em ${fmtDS(team.endsOn)}`;
  return null;
}

// Detecta sobreposição de horário entre turnos do MESMO dia (docs/specs/multi-equipe.md §6).
// O detector não pode "gritar lobo": sobreposição entre pessoas diferentes é
// frequentemente cobertura dupla intencional (feriados com dupla escala montada
// como turnos separados) — só a MESMA pessoa em dois turnos que se sobrepõem é
// inequivocamente um problema (pagamento em duplicidade).
function detectOverlaps(day, dateStr, subs) {
  const parsed = day.shifts.map(s => {
    const tr = parseTimeRange(s.time);
    if (!tr) return null;
    let start = tr.sh * 60 + tr.sm, end = tr.eh * 60 + tr.em;
    if (end <= start) end += 1440; // cruza meia-noite
    const people = resolveShiftPeople(s, dateStr, subs).map(r => r.person);
    return { start, end, people };
  }).filter(Boolean);

  let samePerson = false, identical = false, partial = false;
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      const a = parsed[i], b = parsed[j];
      if (!(a.start < b.end && b.start < a.end)) continue; // não se sobrepõem
      if (a.people.some(p => b.people.includes(p))) { samePerson = true; continue; }
      if (a.start === b.start && a.end === b.end) identical = true;
      else partial = true;
    }
  }
  return { samePerson, identical, partial };
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

  // ─── EQUIPE ATIVA (aba Escala) ───────────────────────────────────────────────
  // Prioridade: hash da URL (#escala/infra, link compartilhável) > teamView salvo
  // no perfil > equipe da própria pessoa > sustentação (docs/specs/multi-equipe.md §5).
  const [activeTeam, setActiveTeamState] = useState(() => {
    const h = hashTeam();
    if (h) return h;
    if (profile?.teamView && TEAMS[profile.teamView]) return profile.teamView;
    return defaultTeamId(profile);
  });
  const team = TEAMS[activeTeam];

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
  const [editForm,       setEditForm]       = useState({ persons: [], period: '', time: '' });
  const [editSaving,     setEditSaving]     = useState(false);
  const [editProgress,   setEditProgress]   = useState(null); // "lote 2 de 3" durante envio em lotes
  const [editError,      setEditError]      = useState(null);
  const [applyToFuture,  setApplyToFuture]  = useState(false);
  const [confirmAction,  setConfirmAction]  = useState(null); // 'apply' | 'reset' | null
  const [addDay,   setAddDay]   = useState(null); // dayKey ao qual estamos adicionando um turno
  const [addForm,  setAddForm]  = useState({ persons: [], period: '', time: '' });
  // "Dividir turno" (docs/specs/multi-equipe.md §6): null = painel fechado; senão
  // { dk, idx, originalPeriod, originalTime, cuts: string[], parts: [{period,persons}] }.
  // cuts.length === parts.length - 1 sempre (N cortes geram N+1 partes).
  const [splitForm, setSplitForm] = useState(null);

  // Troca a equipe ativa: atualiza hash + perfil, e limpa estado específico da
  // equipe anterior (filtro, seleção de edição, mês) para não vazar entre elas.
  function switchTeam(id) {
    if (id === activeTeam) return;
    setActiveTeamState(id);
    saveProfile({ teamView: id });
    window.history.replaceState(null, '', `#escala/${id}`);
    setFilter(null);
    setEditMode(false);
    setSelectedShifts(new Set());
    setAddDay(null);
    setSplitForm(null);
    setMonthKey(null); // volta pro mês atual — evita cair num mês sem dias na equipe nova
    setSubForm({ show: false, titular: "", substituto: "", from: "", until: "" });
  }

  // Carrega substituições e overrides do servidor, para a equipe ativa
  const loadOverrides = useCallback((teamId) => {
    setOverridesLoading(true);
    setOverridesError(false);
    api(`/api/schedule?team=${teamId}`)
      .then(data => { setOverrides(data?.overrides || {}); setLabels(data?.labels || {}); })
      .catch(err => { console.error(err); setOverridesError(true); })
      .finally(() => setOverridesLoading(false));
  }, [api]);

  useEffect(() => {
    setSubsLoading(true);
    api(`/api/substitutions?team=${activeTeam}`)
      .then(data => setSubs(data || []))
      .catch(console.error)
      .finally(() => setSubsLoading(false));
    loadOverrides(activeTeam);
  }, [activeTeam]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const schedule = useMemo(() => buildSchedule(team, overrides, labels), [team, overrides, labels]);
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
  // monthKey salvo pode ser de OUTRA equipe (vigência diferente) — só usa se
  // existir de fato nesta; senão cai no mês atual, e na ausência dele, no
  // primeiro mês que a equipe tiver (pode não haver nenhum → activeMonth null,
  // tratado como estado vazio abaixo).
  const validMonthKey = monthKey && months.some(m => m.key === monthKey) ? monthKey : null;
  const activeMonth = validMonthKey || (months.some(m => m.key === currentMonthKey) ? currentMonthKey : (months[0]?.key ?? null));

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
    () => activeMonth ? schedule.filter(d => `${d.date.getFullYear()}-${d.date.getMonth()}` === activeMonth) : [],
    [schedule, activeMonth]
  );

  // ─── WIDGET "AGORA" — sempre as três equipes (docs/specs/multi-equipe.md §5) ──
  // Ignora o seletor: cada equipe usa SEMPRE o próprio dayStart (nunca o da
  // equipe ativa) — passar o dayStart errado desloca a escala em um dia sem erro
  // visível (ver ADR-0002 e Commit 1).
  const [teamsNow, setTeamsNow] = useState({}); // { [teamId]: { schedule, subs } }

  useEffect(() => {
    let cancelled = false;
    Promise.all(Object.values(TEAMS).map(t =>
      Promise.all([
        api(`/api/schedule?team=${t.id}`),
        api(`/api/substitutions?team=${t.id}`),
      ]).then(([schedData, subsData]) => ({
        id: t.id,
        schedule: buildSchedule(t, schedData?.overrides || {}, schedData?.labels || {}),
        subs: subsData || [],
      })).catch(() => ({ id: t.id, schedule: null, subs: [] }))
    )).then(results => {
      if (cancelled) return;
      setTeamsNow(prev => {
        const next = { ...prev };
        results.forEach(r => {
          // Uma falha pontual nunca regride uma entrada que já tinha dado bom — a
          // equipe ativa, em particular, é sempre recomputável localmente (ver o
          // efeito de sincronização abaixo) e não deve virar "carregando" por causa
          // de uma falha de rede neste fetch específico.
          if (r.schedule === null && prev[r.id]?.schedule) return;
          next[r.id] = { schedule: r.schedule, subs: r.subs };
        });
        return next;
      });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mantém a linha da equipe ativa sempre em dia com o que acabou de ser editado,
  // sem esperar o próximo refresh (as outras duas só atualizam na montagem).
  useEffect(() => {
    setTeamsNow(prev => ({ ...prev, [activeTeam]: { schedule, subs } }));
  }, [activeTeam, schedule, subs]);

  const nowRows = useMemo(() => Object.values(TEAMS).map(t => {
    const vig = teamVigenciaMessage(t, todayStr);
    if (vig) return { team: t, vig };
    const snap = teamsNow[t.id];
    if (!snap || !snap.schedule) return { team: t, loading: true };
    return { team: t, onCall: currentOnCall(now, snap.schedule, snap.subs, t.dayStart) };
  }), [teamsNow, now, todayStr]);

  // { people: [{ person, coveringFor }], label, time } | null — pode ter +1 pessoa (feriado)
  const onCall = currentOnCall(now, schedule, subs, team.dayStart);
  const onCallColor = onCall && onCall.people.length === 1
    ? (MEMBERS[onCall.people[0].person] || {}).color || "#94A3B8"
    : "#94A3B8";

  // Handoff: plantonista anterior e próximo (com substituições), referente à equipe ativa
  const handoff = useMemo(() => adjacentOnCall(now, schedule, subs, team.dayStart), [now, schedule, subs, team]);

  const coverSuggestions = useMemo(() => {
    if (!subForm.titular || !subForm.from || !subForm.until || subForm.from > subForm.until) return [];
    return getCoverSuggestions(subForm.titular, subForm.from, subForm.until, schedule, team.roster);
  }, [subForm.titular, subForm.from, subForm.until, schedule, team]);

  const upcoming = useMemo(() => {
    if (!filter) return [];
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const rows = [];
    for (const d of schedule) {
      if (d.date < today) continue;
      const dk = dayKey(d.date);
      d.shifts.forEach(s => {
        const people = shiftPeople(s);
        const locked = !!s.personsOverridden; // turno travado por override não aplica sub
        if (people.includes(filter)) {
          const sub = locked ? null : getActiveSub(filter, dk, subs);
          rows.push({ date:d.date, dow:d.dow, ...s, kind:"turno", coveredBy: sub ? sub.substituto : null });
        } else if (!locked) {
          // filter pode estar cobrindo alguém deste turno (substituto)
          const titular = people.find(p => { const sub = getActiveSub(p, dk, subs); return sub && sub.substituto === filter; });
          if (titular) rows.push({ date:d.date, dow:d.dow, ...s, kind:"turno", coveringFor: titular });
        }
      });
      if (d.folga.includes(filter) && d.dow === 6) {
        const sub = getActiveSub(filter, dayKey(d.date), subs);
        if (!sub) rows.push({ date:d.date, dow:d.dow, period:"Folga FDS", time:"Sáb + Dom", person:filter, kind:"folga" });
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
    const newSub = { team: activeTeam, titular: subForm.titular, substituto: subForm.substituto, from: subForm.from, until: subForm.until };
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
      await api(`/api/substitutions?id=${sub.id}&team=${activeTeam}`, { method: 'DELETE' });
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
        body: { team: activeTeam, titular: sub.titular, substituto: sub.substituto, from: sub.from, until: sub.until },
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
    setEditForm({ persons: [], period: '', time: '' });
    setApplyToFuture(false);
    setAddDay(null);
    setSplitForm(null);
  }

  const togglePerson = (list, name) =>
    list.includes(name) ? list.filter(p => p !== name) : [...list, name];

  // Expands a base patch (selected shifts only) to all future occurrences of the
  // same shift pattern: same weekday for weekday shifts, same cycle-week + dow for weekend shifts.
  //
  // Defeito §7.1 corrigido: casava e.shifts[numIdx] por POSIÇÃO no array, mas
  // e.shifts é compactado (só contém os turnos que existem naquele dia) — um dia
  // com turno extra (feriado) deslocava os índices e o patch acertava o turno
  // errado. Casa por s.idx (a chave estável do override) em vez da posição.
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
          if (!e.shifts.some(s => s.idx === numIdx)) continue;
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
        basePatch[dk][idx] = Object.keys(override).length ? override : null;
      } else {
        basePatch[dk][idx] = null;
      }
    }
    return basePatch;
  }

  // Divide um patch de overrides em lotes de até PATCH_BATCH_DAYS dias — propagar
  // 1 turno pelo range inteiro (~365 dias) gera ~30 KB, perto do limite de 50 KB
  // do corpo da requisição (defeito §7.2). Cada lote é uma requisição própria;
  // o servidor mescla cada uma no que já está salvo, então a ordem não importa.
  function chunkPatchByDays(patch) {
    const days = Object.keys(patch);
    if (days.length <= PATCH_BATCH_DAYS) return [patch];
    const batches = [];
    for (let i = 0; i < days.length; i += PATCH_BATCH_DAYS) {
      const batch = {};
      days.slice(i, i + PATCH_BATCH_DAYS).forEach(dk => { batch[dk] = patch[dk]; });
      batches.push(batch);
    }
    return batches;
  }

  async function postPatch(patch, clearForm) {
    setEditSaving(true);
    setEditError(null);
    setEditProgress(null);
    const batches = chunkPatchByDays(patch);
    try {
      let lastResult = null;
      for (let i = 0; i < batches.length; i++) {
        if (batches.length > 1) setEditProgress(`Salvando lote ${i + 1} de ${batches.length}…`);
        lastResult = await api('/api/schedule', { method: 'POST', body: { team: activeTeam, overrides: batches[i] } });
      }
      if (lastResult) { setOverrides(lastResult.overrides || {}); setLabels(lastResult.labels || {}); }
      setSelectedShifts(new Set());
      if (clearForm) setEditForm({ persons: [], period: '', time: '' });
      setApplyToFuture(false);
    } catch (e) {
      setEditError(friendlyError(e));
      // Lotes anteriores podem ter sido salvos com sucesso — recarrega do servidor
      // para o estado local nunca mostrar algo diferente do que está persistido.
      loadOverrides(activeTeam);
    } finally {
      setEditSaving(false);
      setEditProgress(null);
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
      const body = { team: activeTeam, overrides: { [addDay]: { [nextIdx]: {
        persons: addForm.persons, period: addForm.period, time: addForm.time,
      } } } };
      const updated = await api('/api/schedule', { method: 'POST', body });
      setOverrides(updated.overrides || {});
      setLabels(updated.labels || {});
      setAddDay(null);
      setAddForm({ persons: [], period: '', time: '' });
    } catch (e) {
      setEditError(friendlyError(e));
    } finally {
      setEditSaving(false);
    }
  }

  // ─── DIVIDIR TURNO (ADMIN) ────────────────────────────────────────────────
  // docs/specs/multi-equipe.md §6: parte o intervalo original em N sub-turnos
  // contíguos, sem sobreposição possível — os cortes são pontos dentro do
  // próprio intervalo, e cada parte nasce como [corte anterior, próximo corte),
  // então a soma das partes é sempre exatamente o intervalo original.

  function fmtMinutes(min) {
    const m = ((min % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }

  // Abre o painel a partir de um turno existente — pré-carrega a 1ª parte com
  // as pessoas/período atuais (mesma convenção do formulário de edição: vazio
  // no override = mantém quem já está; aqui só se aplica à 1ª parte, que reusa
  // o idx original — as demais nascem sem base, então vazio ali é turno vago).
  function openSplitForm(dk, idx, shift) {
    setAddDay(null);
    setEditError(null);
    setSplitForm({
      dk, idx,
      originalPeriod: shift.period,
      originalTime: shift.time,
      cuts: [''],
      parts: [
        { period: shift.period, persons: shiftPeople(shift) },
        { period: '', persons: [] },
      ],
    });
  }

  function updateSplitPart(pi, field, value) {
    setSplitForm(f => f && { ...f, parts: f.parts.map((p, i) => i === pi ? { ...p, [field]: value } : p) });
  }

  function updateSplitCut(pi, value) {
    setSplitForm(f => f && { ...f, cuts: f.cuts.map((c, i) => i === pi ? value : c) });
  }

  const MAX_SPLIT_PARTS = 8;

  function addSplitCut() {
    setSplitForm(f => (f && f.parts.length < MAX_SPLIT_PARTS)
      ? { ...f, cuts: [...f.cuts, ''], parts: [...f.parts, { period: '', persons: [] }] }
      : f);
  }

  function removeSplitCut() {
    setSplitForm(f => (f && f.cuts.length > 1) ? { ...f, cuts: f.cuts.slice(0, -1), parts: f.parts.slice(0, -1) } : f);
  }

  // Converte os cortes em fronteiras de minutos absolutos (o turno pode cruzar
  // meia-noite — mesma convenção de shiftDuration/detectOverlaps: um horário
  // que cai antes do início pertence à "volta" seguinte, +1440min).
  const splitPreview = useMemo(() => {
    if (!splitForm) return null;
    const tr = parseTimeRange(splitForm.originalTime);
    if (!tr) return { error: 'Horário do turno original inválido.', parts: null };
    const startMin = tr.sh * 60 + tr.sm;
    let endMin = tr.eh * 60 + tr.em;
    if (endMin <= startMin) endMin += 1440;

    const boundaries = [startMin];
    for (const cut of splitForm.cuts) {
      if (!cut) return { error: 'Preencha o horário de todos os cortes.', parts: null };
      const [h, m] = cut.split(':').map(Number);
      if (Number.isNaN(h) || Number.isNaN(m)) return { error: 'Horário de corte inválido.', parts: null };
      let cutMin = h * 60 + m;
      if (cutMin <= startMin) cutMin += 1440;
      boundaries.push(cutMin);
    }
    boundaries.push(endMin);

    for (let i = 1; i < boundaries.length; i++) {
      if (boundaries[i] <= boundaries[i - 1]) {
        return { error: 'Os cortes devem estar em ordem crescente e dentro do horário do turno original.', parts: null };
      }
    }

    return {
      error: null,
      parts: splitForm.parts.map((_, i) => ({ time: `${fmtMinutes(boundaries[i])} – ${fmtMinutes(boundaries[i + 1])}` })),
    };
  }, [splitForm]);

  async function applySplit() {
    if (!splitForm || editSaving || !splitPreview || splitPreview.error) return;
    if (splitForm.parts.some(p => !p.period.trim())) {
      setEditError('Preencha o período de cada parte.');
      return;
    }
    const day = schedule.find(d => dayKey(d.date) === splitForm.dk);
    let nextIdx = day ? day.shifts.reduce((mx, s) => Math.max(mx, s.idx), -1) + 1 : 0;
    const dayPatch = {};
    splitForm.parts.forEach((p, i) => {
      const idx = i === 0 ? splitForm.idx : nextIdx++;
      const override = { period: p.period.trim(), time: splitPreview.parts[i].time };
      if (p.persons.length) override.persons = p.persons; // vazio = omite (§ vago/mantém, ver comentário acima)
      dayPatch[idx] = override;
    });
    setEditSaving(true);
    setEditError(null);
    try {
      const updated = await api('/api/schedule', { method: 'POST', body: { team: activeTeam, overrides: { [splitForm.dk]: dayPatch } } });
      setOverrides(updated.overrides || {});
      setLabels(updated.labels || {});
      setSplitForm(null);
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
      const updated = await api('/api/schedule', { method: 'POST', body: { team: activeTeam, labels: { [dk]: v || null } } });
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
        if (!e.shifts.some(s => s.idx === numIdx)) return false; // casa pelo idx estável, não pela posição (§7.1)
        return isWeekend
          ? (e.dow === 0 || e.dow === 6) && e.cycleWeek === entry.cycleWeek && e.dow === entry.dow
          : e.dow === entry.dow;
      }).length;
    }
    return count;
  }, [applyToFuture, selectedShifts, schedule]);

  // Conflitos entre a edição e substituições existentes: se o admin coloca no turno
  // alguém que TEM substituição ativa (é titular) na data selecionada, avisamos —
  // com a regra "edição vence", essa pessoa fica no turno e a substituição não vale ali.
  const editSubConflicts = useMemo(() => {
    if (!editForm.persons.length || !selectedShifts.size) return [];
    const seen = new Set(); const out = [];
    for (const key of selectedShifts) {
      const dk = key.slice(0, key.lastIndexOf('-'));
      for (const person of editForm.persons) {
        const sub = getActiveSub(person, dk, subs);
        if (sub) {
          const k = `${dk}|${person}`;
          if (!seen.has(k)) { seen.add(k); out.push({ dk, person, substituto: sub.substituto }); }
        }
      }
    }
    return out;
  }, [editForm.persons, selectedShifts, subs]);

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

  // Texto/cor de uma linha do widget "Agora" (docs/specs/multi-equipe.md §5):
  // vigência > carregando > sem cobertura agora > turno vago > nome(s).
  function rowInfo(row) {
    if (row.vig) return { text: row.vig, dotColor: "#64748B", until: null };
    if (row.loading) return { text: "…", dotColor: "#475569", until: null };
    if (!row.onCall) return { text: "Sem plantão", dotColor: "#475569", until: null };
    if (row.onCall.people.length === 0) return { text: "Turno vago", dotColor: WARN, until: null };
    const until = row.onCall.time.split(/[–—-]/)[1]?.trim();
    const dotColor = row.onCall.people.length === 1
      ? (MEMBERS[row.onCall.people[0].person] || {}).color || "#94A3B8"
      : "#94A3B8";
    return { text: row.onCall.people.map(p => p.person).join(" · "), dotColor, until };
  }

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
            <div className="rounded-xl px-4 py-3 min-w-[230px]" style={{ background:"rgba(255,255,255,0.08)", borderLeft:`4px solid ${scheduleReady ? onCallColor : "rgba(255,255,255,0.25)"}` }}>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider opacity-80">
                <span className="relative flex w-2 h-2">
                  <span className="animate-ping motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background:scheduleReady ? onCallColor : "#94A3B8" }} />
                  <span className="relative inline-flex rounded-full w-2 h-2" style={{ background:scheduleReady ? onCallColor : "#94A3B8" }} />
                </span>
                Agora
              </div>

              {/* Sempre as três equipes, ignorando o seletor (docs/specs/multi-equipe.md §5) */}
              <div className="mt-1.5">
                {nowRows.map(row => {
                  const info = rowInfo(row);
                  return (
                    <div key={row.team.id} style={{ display:"flex", alignItems:"center", gap:"0.45rem", marginTop:"0.3rem" }}>
                      <span style={{ width:7, height:7, borderRadius:"50%", flexShrink:0, background:info.dotColor }} />
                      <span style={{ width:"5.2rem", flexShrink:0, fontSize:"0.68rem", color:"rgba(255,255,255,0.6)" }}>{row.team.nome}</span>
                      <span className="truncate" style={{ fontSize:"0.82rem", fontWeight:600 }}>{info.text}</span>
                      {info.until && (
                        <span style={{ fontSize:"0.65rem", color:"rgba(255,255,255,0.5)", flexShrink:0 }}>até {info.until}</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Handoff: plantonista anterior e próximo, referente à equipe selecionada */}
              {scheduleReady && (handoff.anterior || handoff.proximo) && (
                <>
                  <div style={{ height:1, background:"rgba(255,255,255,0.12)", margin:"0.7rem 0 0.15rem" }} />
                  <div style={{ fontSize:"0.62rem", color:"rgba(255,255,255,0.45)", marginBottom:"0.15rem" }}>{team.nome}</div>
                  {[
                    { label:"antes",  data:handoff.anterior, prefix:"até " },
                    { label:"depois", data:handoff.proximo,  prefix:"" },
                  ].map(({ label, data, prefix }) => (
                    <div key={label} style={{ display:"flex", alignItems:"center", gap:"0.5rem", fontSize:"0.8rem", marginTop:"0.4rem" }}>
                      <span style={{ width:"3rem", flex:"none", fontSize:"0.7rem", color:"rgba(255,255,255,0.5)" }}>{label}</span>
                      {data ? (
                        <>
                          <span style={{ width:8, height:8, borderRadius:"50%", flex:"none", background: data.people.length === 1 ? ((MEMBERS[data.people[0]]||{}).color||"#94A3B8") : "#94A3B8", boxShadow:"0 0 0 1px rgba(255,255,255,0.15)" }} />
                          <span style={{ fontWeight:600, color:"#E2E8F0" }}>{data.people.length ? data.people.join(" / ") : "vago"}</span>
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

        {/* SELETOR DE EQUIPE */}
        <section className="mb-4" aria-label="Seletor de equipe">
          <div className="flex flex-wrap gap-2">
            {Object.values(TEAMS).map(t => (
              <button key={t.id} onClick={() => switchTeam(t.id)} aria-pressed={activeTeam === t.id}
                className="px-3.5 rounded-full text-sm font-bold transition-all"
                style={{ minHeight:"2.5rem", background:activeTeam===t.id?ACCENT:T.filterDefBg, color:activeTeam===t.id?"#fff":T.filterDefColor, border:`1.5px solid ${activeTeam===t.id?ACCENT:T.filterDefBorder}` }}>
                {t.nome}
              </button>
            ))}
          </div>
        </section>

        {overridesError && (
          <div role="alert" className="rounded-xl px-4 py-3 mb-4 flex items-center justify-between gap-3 flex-wrap"
            style={{ background:"rgba(245,158,11,0.12)", border:`1px solid ${WARN}` }}>
            <span className="flex items-center gap-2 text-sm font-semibold" style={{ color:WARN }}>
              <Icon name="alert" size={16} />
              Não foi possível carregar as edições da escala — mostrando a escala base.
            </span>
            <button onClick={() => loadOverrides(activeTeam)}
              style={{ background:"transparent", border:`1px solid ${WARN}`, color:WARN, borderRadius:"9999px", padding:"0.35rem 0.9rem", fontSize:"0.75rem", fontWeight:700, cursor:"pointer", minHeight:"2.25rem" }}>
              Tentar de novo
            </button>
          </div>
        )}

        {/* FILTRO — limitado ao roster da equipe selecionada */}
        <section className="mb-4" aria-label="Filtro por responsável">
          <h2 className="text-sm font-semibold mb-2" style={{ color:T.textSecondary }}>Filtrar por responsável</h2>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => { setFilter(null); saveProfile({ filter: null }); }} className="px-3.5 rounded-full text-sm font-bold transition-all"
              style={{ minHeight:"2.5rem", background:!filter?T.filterAllBg:T.filterDefBg, color:!filter?T.filterAllColor:T.filterDefColor, border:"1.5px solid "+(!filter?T.filterAllBorder:T.filterDefBorder) }}>
              Todos
            </button>
            {team.roster.map(name => {
              const p = MEMBERS[name] || { color: "#64748B" };
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
              <span className="w-3 h-3 rounded-full" style={{ background: (MEMBERS[filter] || {}).color }} />
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
                        <span className="font-semibold" style={{ color: (MEMBERS[filter] || {}).color }}>{u.period}</span>
                      )}
                      {u.coveringFor && <span className="text-[10px] font-bold rounded px-1.5 py-0.5" style={{ background:"#DBEAFE", color:"#1D4ED8" }}>cobre {u.coveringFor}</span>}
                      {u.coveredBy  && <span className="text-[10px] font-bold rounded px-1.5 py-0.5" style={{ background:"#F3E5F5", color:"#7B1FA2" }}>coberto por {u.coveredBy}</span>}
                    </div>
                    <span className="font-mono text-xs" style={{ color:T.textMuted }}>{u.time}{shiftDuration(u.time)?` · ${shiftDuration(u.time)}`:""}</span>
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
        ) : !am ? (
          // Estado vazio: equipe sem dias neste período (fora da vigência —
          // infra e desenvolvimento só existem a partir de startsOn).
          <div className="rounded-xl p-6 mb-4 text-center text-sm" style={{ background:T.cardBg, border:`1px solid ${T.cardBorder}`, color:T.textMuted }}>
            {team.nome} não tem escala neste período.
            {team.startsOn && ` A equipe existe a partir de ${fmtDS(team.startsOn)}.`}
          </div>
        ) : (
        <div className="space-y-2 pb-4">
          {monthDays.map(d => {
            const isToday   = sameDay(d.date, now);
            const isWeekend = d.dow === 0 || d.dow === 6;
            const isPast    = !isToday && d.date < now;
            const dk        = dayKey(d.date);
            const hasFiltered = !filter || d.shifts.some(s => {
              const locked = !!s.personsOverridden;
              return shiftPeople(s).some(p => {
                const sub = locked ? null : getActiveSub(p, dk, subs);
                return (sub ? sub.substituto : p) === filter || p === filter;
              });
            }) || d.folga.includes(filter);
            const overlap = detectOverlaps(d, dk, subs);
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
                    {(d.label || (editMode && isAdmin) || overlap.samePerson || overlap.partial || overlap.identical) && (
                      <div className="flex flex-wrap items-center gap-2 mb-1.5">
                        {d.label && !editMode && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold rounded px-1.5 py-0.5" style={{ background:"rgba(99,102,241,0.15)", color:"#A5B4FC" }}>
                            <Icon name="umbrella" size={10} /> {d.label}
                          </span>
                        )}
                        {/* Detector de sobreposição (§6): só a MESMA pessoa em turnos que se
                            sobrepõem é aviso forte — pessoas diferentes em janelas idênticas é
                            cobertura dupla intencional (feriado com dupla escala), sem alarme. */}
                        {overlap.samePerson && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold rounded px-1.5 py-0.5" style={{ background:"rgba(239,68,68,0.15)", color:DANGER }}>
                            <Icon name="alert" size={10} /> mesma pessoa em turnos sobrepostos
                          </span>
                        )}
                        {overlap.partial && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold rounded px-1.5 py-0.5" style={{ background:"rgba(245,158,11,0.15)", color:WARN }}>
                            <Icon name="alert" size={10} /> sobreposição parcial
                          </span>
                        )}
                        {overlap.identical && !overlap.samePerson && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold rounded px-1.5 py-0.5" style={{ background:"rgba(148,163,184,0.15)", color:"#94A3B8" }}>
                            cobertura dupla
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
                    {/* Semana do ciclo / Folga FDS só existem em equipe com rotação (a
                        sustentação) — infra e desenvolvimento não têm rodízio, então
                        d.cycleWeek vem null e não há nada a mostrar aqui. */}
                    {isWeekend && d.dow === 6 && d.cycleWeek !== null && (
                      <div className="flex flex-wrap items-center gap-2 mb-1.5">
                        <span className="text-[10px] font-bold rounded px-1.5 py-0.5" style={{ background:T.cycleBg, color:T.cycleColor }}>
                          Semana {d.cycleWeek} do ciclo
                        </span>
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold rounded px-1.5 py-0.5" style={{ background:"#FEF9C3", color:"#854D0E", opacity: filter && !d.folga.includes(filter) ? 0.4 : 1 }}>
                          <Icon name="umbrella" size={11} /> Folga FDS: {d.folga.join(", ")}
                        </span>
                      </div>
                    )}
                    <div className="space-y-0.5">
                      {sortShiftsByStart(d.shifts, team.dayStart).map((s) => {
                        const i = s.idx; // índice estável do override (não a posição no array)
                        const people = resolveShiftPeople(s, dk, subs)
                          .map(r => ({ person: r.person, subOf: r.coveringFor, titular: r.titular }));
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
                            <span className="font-mono text-xs w-9" style={{ color:T.textMuted }}>{shiftDuration(s.time)}</span>
                            <span className="inline-flex flex-wrap items-center gap-1">
                              {people.length > 0 ? (
                                people.map((p, pi) => <PersonTag key={pi} name={p.person} subOf={p.subOf} />)
                              ) : isAdmin && !editMode ? (
                                <button type="button"
                                  onClick={() => { setEditMode(true); setSelectedShifts(new Set([shiftKey])); }}
                                  style={{ fontSize:'0.7rem', fontWeight:700, color:WARN, background:'rgba(245,158,11,0.1)', border:`1px dashed ${WARN}`, borderRadius:'0.4rem', padding:'0.15rem 0.55rem', cursor:'pointer' }}>
                                  sem plantonista — atribuir
                                </button>
                              ) : (
                                <span style={{ fontSize:'0.75rem', fontWeight:600, color:T.textMuted, fontStyle:'italic' }}>sem plantonista</span>
                              )}
                            </span>
                            {recent ? (
                              <span title={`Alterado em ${fmtEdited(ov.editedAt)}`} style={{ fontSize:'0.6rem', color:'#818CF8', fontWeight:'700', background:'rgba(99,102,241,0.1)', borderRadius:'3px', padding:'0 4px' }}>
                                alterado {fmtEdited(ov.editedAt)}
                              </span>
                            ) : (editMode && hasOverride) ? (
                              <span style={{ fontSize:'0.6rem', color:T.textMuted, fontWeight:'700', background:'rgba(148,163,184,0.12)', borderRadius:'3px', padding:'0 4px' }}>editado</span>
                            ) : null}
                            {editMode && isAdmin && (
                              <button type="button"
                                onClick={(e) => { e.stopPropagation(); openSplitForm(dk, i, s); }}
                                title="Dividir este turno em partes"
                                style={{ marginLeft:'auto', fontSize:'0.65rem', fontWeight:700, color:T.textMuted, background:'transparent', border:`1px solid ${T.cardBorder}`, borderRadius:'0.4rem', padding:'0.15rem 0.5rem', minHeight:'1.75rem', cursor:'pointer' }}>
                                Dividir
                              </button>
                            )}
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
                        </div>
                        <div className="mb-2"><PersonPicker selected={addForm.persons} onToggle={n => setAddForm(f => ({ ...f, persons: togglePerson(f.persons, n) }))} roster={team.roster} /></div>
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
                      <button onClick={() => { setAddDay(dk); setAddForm({ persons: [], period: '', time: '' }); setEditError(null); }}
                        className="mt-1.5 inline-flex items-center gap-1"
                        style={{ background:'transparent', color:T.textMuted, border:`1px dashed ${T.cardBorder}`, borderRadius:'0.5rem', padding:'0.35rem 0.7rem', minHeight:'2.25rem', fontSize:'0.72rem', fontWeight:700, cursor:'pointer' }}>
                        <Icon name="plus" size={12} /> Adicionar turno
                      </button>
                    ))}

                    {/* Dividir turno (admin, modo edição) — docs/specs/multi-equipe.md §6 */}
                    {editMode && isAdmin && splitForm?.dk === dk && (
                      <div className="mt-2 pt-2" style={{ borderTop:`1px dashed ${T.cardBorder}` }}>
                        <div className="text-xs font-semibold mb-1" style={{ color:T.textSecondary }}>
                          Dividir turno · {splitForm.originalPeriod} · {splitForm.originalTime}
                        </div>
                        <p className="text-xs mb-2" style={{ color:T.textMuted }}>
                          Pessoas vazias mantêm quem já está na 1ª parte; nas partes novas, viram turno vago.
                        </p>
                        {splitPreview?.error && (
                          <p role="alert" className="flex items-center gap-1.5 text-xs font-semibold mb-2" style={{ color:DANGER }}>
                            <Icon name="alert" size={13} /> {splitPreview.error}
                          </p>
                        )}
                        {splitForm.parts.map((part, pi) => (
                          <div key={pi} className="mb-2 pb-2" style={{ borderBottom: pi < splitForm.parts.length - 1 ? `1px dashed ${T.divider}` : 'none' }}>
                            <div className="flex flex-wrap items-center gap-2 mb-1.5">
                              <span className="font-mono text-xs font-bold" style={{ color:T.textSecondary, minWidth:'7rem' }}>
                                {splitPreview?.parts?.[pi]?.time || '…'}
                              </span>
                              <input value={part.period} onChange={e => updateSplitPart(pi, 'period', e.target.value)}
                                placeholder="Período (ex: Manhã)" style={{ ...selStyle, marginTop:0, maxWidth:'11rem' }} />
                            </div>
                            <PersonPicker selected={part.persons} onToggle={n => updateSplitPart(pi, 'persons', togglePerson(part.persons, n))} roster={team.roster} />
                            {pi < splitForm.cuts.length && (
                              <div className="flex items-center gap-2 mt-1.5">
                                <label style={labelStyle}>corte em</label>
                                <input type="time" value={splitForm.cuts[pi]} onChange={e => updateSplitCut(pi, e.target.value)}
                                  style={{ ...selStyle, marginTop:0, width:'8rem' }} />
                              </div>
                            )}
                          </div>
                        ))}
                        <div className="flex flex-wrap gap-2 mb-2">
                          <button type="button" onClick={addSplitCut} disabled={splitForm.parts.length >= MAX_SPLIT_PARTS}
                            style={{ background:'transparent', color:T.textSecondary, border:`1px dashed ${T.cardBorder}`, borderRadius:'0.5rem', padding:'0.35rem 0.7rem', minHeight:'2.25rem', fontSize:'0.72rem', fontWeight:700, cursor: splitForm.parts.length >= MAX_SPLIT_PARTS ? 'not-allowed' : 'pointer' }}>
                            + Adicionar corte
                          </button>
                          {splitForm.cuts.length > 1 && (
                            <button type="button" onClick={removeSplitCut}
                              style={{ background:'transparent', color:T.textMuted, border:`1px solid ${T.cardBorder}`, borderRadius:'0.5rem', padding:'0.35rem 0.7rem', minHeight:'2.25rem', fontSize:'0.72rem', fontWeight:700, cursor:'pointer' }}>
                              Remover último corte
                            </button>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button onClick={applySplit} disabled={editSaving || !!splitPreview?.error}
                            style={{ background: (editSaving || splitPreview?.error) ? T.cardBorder : ACCENT, color:'#fff', border:'none', borderRadius:'0.5rem', padding:'0.4rem 0.9rem', minHeight:'2.5rem', fontWeight:700, fontSize:'0.78rem', cursor: (editSaving || splitPreview?.error) ? 'not-allowed' : 'pointer' }}>
                            {editSaving ? 'Salvando…' : `Dividir em ${splitForm.parts.length} partes`}
                          </button>
                          <button onClick={() => { setSplitForm(null); setEditError(null); }}
                            style={{ background:'transparent', color:T.textMuted, border:`1px solid ${T.cardBorder}`, borderRadius:'0.5rem', padding:'0.4rem 0.9rem', minHeight:'2.5rem', fontWeight:700, fontSize:'0.78rem', cursor:'pointer' }}>
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
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
                    {team.roster.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  </label>
                </div>
                <div>
                  <label style={labelStyle}>Substituto
                  <select value={subForm.substituto} onChange={e => setSubForm(f => ({ ...f, substituto:e.target.value }))} style={selStyle}>
                    <option value="">Selecionar…</option>
                    {team.roster.filter(p => p !== subForm.titular).map(p => <option key={p} value={p}>{p}</option>)}
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
                    <PersonPicker selected={editForm.persons} onToggle={n => setEditForm(f => ({ ...f, persons: togglePerson(f.persons, n) }))} roster={team.roster} />
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

                {editSubConflicts.length > 0 && (
                  <div role="alert" style={{ display:'flex', gap:'0.5rem', alignItems:'flex-start', background:'rgba(245,158,11,0.1)', border:`1px solid ${WARN}`, borderRadius:'0.6rem', padding:'0.6rem 0.75rem', margin:'0 0 0.75rem 0' }}>
                    <Icon name="alert" size={14} style={{ color:WARN, flexShrink:0, marginTop:'0.1rem' }} />
                    <div style={{ fontSize:'0.72rem', color:T.textSecondary, lineHeight:1.5 }}>
                      <b style={{ color:WARN }}>Conflito com substituição.</b>{' '}
                      {editSubConflicts.map((c, i) => (
                        <span key={i}>
                          <b style={{ color:T.textPrimary }}>{c.person}</b> tem substituição ativa ({c.person} → {c.substituto}) em {fmtDS(c.dk)}
                          {i < editSubConflicts.length - 1 ? '; ' : '. '}
                        </span>
                      ))}
                      Com esta edição a pessoa é <b>mantida no turno</b> — a substituição não se aplica aqui. Se quer que o substituto assuma, use o formulário de Substituições.
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 items-center">
                  <button onClick={applyEditOverrides} disabled={editSaving}
                    style={{ background:editSaving?T.cardBorder:ACCENT, color:'#fff', border:'none', borderRadius:'0.5rem', padding:'0.5rem 1rem', minHeight:'2.75rem', fontWeight:700, fontSize:'0.8rem', cursor:editSaving?'not-allowed':'pointer' }}>
                    {editSaving ? (editProgress || 'Salvando…') : applyToFuture ? `Aplicar a ${futureShiftCount} turnos` : 'Aplicar alteração'}
                  </button>
                  <button onClick={resetSelectedShifts} disabled={editSaving}
                    style={{ background:'transparent', color:DANGER, border:`1px solid ${DANGER}`, borderRadius:'0.5rem', padding:'0.5rem 0.85rem', minHeight:'2.75rem', fontWeight:700, fontSize:'0.8rem', cursor:editSaving?'not-allowed':'pointer' }}>
                    {editSaving ? (editProgress || 'Salvando…') : applyToFuture ? `Resetar ${futureShiftCount} turnos` : 'Resetar para padrão'}
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
          Escala seg–sex fixa · rodízio de fim de semana em escada de 6 semanas (a partir de 18/07/2026) · 4 de plantão + 2 de folga
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
