import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useApi } from '../lib/api';
import {
  DOW, DOW_SHORT, MONTHS, MONTHS_SHORT,
  MS_DAY, dayKey, sameDay, fmtDS,
  buildSchedule, currentOnCall, adjacentOnCall,
  getActiveSub, getCoverSuggestions, shiftPeople, resolveShiftPeople, parseTimeRange,
  shiftDuration, sortShiftsByStart,
} from '../lib/schedule';
import { TEAMS, teamScopeCovers } from '../lib/teams';
import { getTheme, memberTone } from '../lib/theme';
import {
  Icon, Snackbar, ConfirmDialog, Skeleton, friendlyError,
  Button, Badge, Segmented, SegmentedItem, Panel, SectionLabel,
} from './ui';

// Envio em lotes de overrides "aplicar a todos os meses seguintes" — propagar 1
// turno pelo range inteiro (~365 dias) gera ~30 KB, perto do limite de 50 KB do
// corpo da requisição (MAX_BODY_BYTES em api/_validate.js); 2 turnos estouram.
const PATCH_BATCH_DAYS = 150;

// Pessoas de TODAS as equipes (src/lib/teams.js) — cores/badges usadas em qualquer
// tela que possa mostrar gente de mais de uma equipe (o widget "Agora", em
// particular, sempre mostra as três). `PEOPLE` (schedule.js) cobre só a sustentação.
// O tom vem de memberTone (OKLCH, lightness fixa por tema) — não mais do par
// color/bg do Material, que era desenhado para fundo claro e sumia no escuro.
function PersonTag({ name, dim, subOf, T, dark }) {
  const tone = memberTone(name, dark);
  return (
    <span
      className="inline-flex items-center gap-1.5 text-sm"
      style={{
        color: tone.ink, background: dim ? 'transparent' : tone.tint,
        opacity: dim ? 0.35 : 1, fontWeight: 600,
        borderRadius: T.rChip, padding: '0.1rem 0.4rem',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: tone.dot, flexShrink: 0 }} />
      {name}
      {subOf && (
        <span style={{ fontSize:'0.6rem', fontWeight:700, color:T.textMuted, letterSpacing:'0.04em', textTransform:'uppercase' }}>
          sub
        </span>
      )}
    </span>
  );
}

// Multi-seleção de pessoas (chips) — usado ao editar e ao adicionar turnos.
// `roster` é a lista de nomes elegíveis — SEMPRE a equipe ativa, nunca todo mundo
// (um turno da sustentação não pode ser atribuído a alguém da infra).
function PersonPicker({ selected, onToggle, roster, T, dark }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {roster.map(name => {
        const tone = memberTone(name, dark);
        const on = selected.includes(name);
        return (
          <button key={name} type="button" onClick={() => onToggle(name)} aria-pressed={on}
            style={{
              display:'inline-flex', alignItems:'center', gap:'0.35rem',
              fontSize:'0.75rem', fontWeight:600, padding:'0.3rem 0.55rem', minHeight:'2.1rem',
              borderRadius:T.rControl, cursor:'pointer',
              background: on ? tone.tint : 'transparent',
              color: on ? tone.ink : T.textSecondary,
              border:`1px solid ${on ? tone.ink : T.border}`,
            }}>
            <span style={{ width:7, height:7, borderRadius:'50%', flexShrink:0, background: tone.dot, opacity: on ? 1 : 0.55 }} />
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

  // Quem pode editar a escala da equipe ATIVA — admin da equipe (adminOf) ou alguém
  // com só o direito de editar a escala dela (scheduleEditOf), sem ganhar CH de
  // outra pessoa, fechamento de mês ou relatório consolidado (isso continua
  // exclusivo de adminOf — ver api/_allowlist.js). Recalculado a cada troca de
  // equipe: a mesma pessoa pode editar uma e não outra.
  const canEditActiveTeam = teamScopeCovers(profile?.adminOf, activeTeam) || teamScopeCovers(profile?.scheduleEditOf, activeTeam);

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

  // Input e rótulo de formulário — tokens do sistema, raio de controle (5px).
  const selStyle = {
    display:"block", width:"100%", padding:"0.45rem 0.55rem", fontSize:"0.82rem", minHeight:"2.25rem",
    borderRadius:T.rControl, border:`1px solid ${T.inputBorder}`,
    background:T.inputBg, color:T.textPrimary, marginTop:"0.25rem",
    // Sem isto, o ícone nativo de calendário/relógio (type="date"/"time") é
    // sempre desenhado escuro pelo navegador — invisível sobre fundo escuro.
    colorScheme: T.dark ? "dark" : "light",
  };

  const labelStyle = { fontSize:"0.72rem", fontWeight:600, color:T.labelColor };

  const scheduleReady = !overridesLoading;

  // Hora do relógio no cabeçalho do painel "Agora". Substitui o ponto pulsante
  // decorativo (animate-ping) por informação: numa ferramenta de plantão o que
  // importa não é uma animação de "ao vivo", é a que hora esta leitura se refere.
  const nowTime = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;

  // Texto/cor de uma linha do widget "Agora" (docs/specs/multi-equipe.md §5):
  // vigência > carregando > sem cobertura agora > turno vago > nome(s).
  function rowInfo(row) {
    if (row.vig)     return { text: row.vig,        tone: T.textMuted, dotColor: T.borderStrong, until: null, quiet: true };
    if (row.loading) return { text: "…",            tone: T.textMuted, dotColor: T.borderStrong, until: null, quiet: true };
    if (!row.onCall) return { text: "Sem plantão",  tone: T.textMuted, dotColor: T.borderStrong, until: null, quiet: true };
    if (row.onCall.people.length === 0) return { text: "Turno vago", tone: T.warn, dotColor: T.warn, until: null };
    const until = row.onCall.time.split(/[–—-]/)[1]?.trim();
    const dotColor = row.onCall.people.length === 1
      ? memberTone(row.onCall.people[0].person, dark).dot
      : T.textSecondary;
    return { text: row.onCall.people.map(p => p.person).join(" · "), tone: T.textPrimary, dotColor, until };
  }

  return (
    <div style={{ minHeight:"100vh", background:T.pageBg, fontFamily:T.fontSans, color:T.textPrimary }}>
      <div className="mx-auto px-3 sm:px-4 py-4" style={{ maxWidth:"1440px" }}>

        {/* Composição de desktop (decisão registrada em PRODUCT.md: tela grande
            vence): coluna principal com a escala e sua edição, barra lateral
            fixa com estado e lentes. Abaixo de lg empilha, e o "Agora" fica
            em cima — que é a ordem certa no celular. */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">

          {/* ══ COLUNA PRINCIPAL ═════════════════════════════════════════════ */}
          <div className="min-w-0 order-2 lg:order-1">

            {overridesError && (
              <div role="alert" className="flex items-center justify-between gap-3 flex-wrap mb-3"
                style={{ background:T.warnQuiet, border:`1px solid ${T.warnBorder}`, borderRadius:T.rPanel, padding:"0.6rem 0.8rem" }}>
                <span className="flex items-center gap-2" style={{ color:T.warn, fontSize:"0.82rem", fontWeight:600 }}>
                  <Icon name="alert" size={15} />
                  Não foi possível carregar as edições da escala — mostrando a escala base.
                </span>
                <Button T={T} size="sm" variant="secondary" onClick={() => loadOverrides(activeTeam)}>
                  Tentar de novo
                </Button>
              </div>
            )}

            {/* BARRA DE FERRAMENTAS — equipe, mês, edição */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <Segmented T={T} role="group" aria-label="Equipe">
                {Object.values(TEAMS).map((t, i) => (
                  <SegmentedItem key={t.id} T={T} first={i === 0}
                    active={activeTeam === t.id} onClick={() => switchTeam(t.id)}>
                    {t.nome}
                  </SegmentedItem>
                ))}
              </Segmented>

              <div className="flex-1" />

              {canEditActiveTeam && (
                <Button T={T} size="sm" variant={editMode ? 'primary' : 'secondary'} onClick={toggleEditMode}>
                  <Icon name={editMode ? 'x' : 'pencil'} size={14} />
                  {editMode ? 'Sair da edição' : 'Editar escala'}
                </Button>
              )}
            </div>

            {/* NAVEGAÇÃO DE MESES */}
            <div className="flex items-center gap-2 mb-3">
              <Button T={T} size="sm" variant="secondary" onClick={goToToday}>Hoje</Button>
              <div className="min-w-0 overflow-x-auto">
                <Segmented T={T} role="group" aria-label="Mês">
                  {months.map((m, i) => (
                    <SegmentedItem key={m.key} T={T} first={i === 0}
                      active={activeMonth === m.key}
                      aria-current={activeMonth === m.key ? 'true' : undefined}
                      onClick={() => handleMonthChange(m.key)}
                      style={{ padding:'0.45rem 0.6rem' }}>
                      <span className="tnum">{MONTHS_SHORT[m.m]}/{String(m.y).slice(2)}</span>
                    </SegmentedItem>
                  ))}
                </Segmented>
              </div>
            </div>

            <div className="flex items-baseline gap-2 mb-2">
              <h1 style={{ fontSize:"1.15rem", fontWeight:700, letterSpacing:"-0.01em", color:T.textPrimary, margin:0 }}>
                {am ? `${MONTHS[am.m]} de ${am.y}` : team.nome}
              </h1>
              {am && (
                <span className="tnum" style={{ fontSize:"0.78rem", color:T.textMuted }}>
                  {monthDays.length} dias
                </span>
              )}
            </div>

            {/* ══ CALENDÁRIO ═════════════════════════════════════════════════
                Um painel com linhas separadas por hairline, não 30 cards
                flutuantes. Estes dados SÃO uma tabela: dias em linhas, turnos
                dentro da linha. Ganha densidade (a restrição fixada pelo dono)
                e calma ao mesmo tempo. */}
            {!scheduleReady ? (
              <div role="status" aria-label="Carregando calendário"
                style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:T.rPanel, overflow:"hidden" }}>
                {[0,1,2,3,4,5].map(i => (
                  <div key={i} style={{ padding:"0.7rem 0.8rem", borderTop: i > 0 ? `1px solid ${T.border}` : "none" }}>
                    <Skeleton h="1.9rem" T={T} />
                  </div>
                ))}
              </div>
            ) : !am ? (
              // Estado vazio: equipe fora da vigência (infra e desenvolvimento
              // só existem a partir de startsOn).
              <Panel T={T} style={{ padding:"2rem 1rem", textAlign:"center" }}>
                <p style={{ color:T.textSecondary, fontSize:"0.88rem", margin:0, fontWeight:600 }}>
                  {team.nome} não tem escala neste período.
                </p>
                {team.startsOn && (
                  <p style={{ color:T.textMuted, fontSize:"0.8rem", margin:"0.35rem 0 0" }}>
                    A equipe existe a partir de {fmtDS(team.startsOn)}.
                  </p>
                )}
              </Panel>
            ) : (
            <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:T.rPanel, overflow:"hidden" }}>
              {monthDays.map((d, di) => {
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
                const rowBg = isToday ? T.accentQuiet : isWeekend ? T.surfaceAlt : "transparent";
                return (
                  <div key={dk} ref={isToday ? todayRef : null}
                    style={{
                      scrollMarginTop:"3.75rem",
                      borderTop: di > 0 ? `1px solid ${T.border}` : "none",
                      background: rowBg,
                      opacity: isPast ? 0.5 : (filter && !hasFiltered) ? 0.32 : 1,
                    }}>
                    <div className="flex items-stretch">
                      {/* CALHA DE DATA */}
                      <div className="flex flex-col items-center justify-start shrink-0"
                        style={{ width:"3.25rem", padding:"0.6rem 0", borderRight:`1px solid ${T.border}` }}>
                        <div style={{ fontSize:"0.62rem", fontWeight:700, letterSpacing:"0.05em", textTransform:"uppercase", color:T.textMuted }}>
                          {DOW_SHORT[d.dow]}
                        </div>
                        <div className="tnum" style={{ fontSize:"1.15rem", fontWeight:700, lineHeight:1.15, color: isToday ? T.accent : T.textPrimary }}>
                          {String(d.date.getDate()).padStart(2,"0")}
                        </div>
                        {isToday && (
                          <div style={{ marginTop:"0.15rem", fontSize:"0.55rem", fontWeight:800, letterSpacing:"0.06em", color:T.accent }}>
                            HOJE
                          </div>
                        )}
                      </div>

                      {/* CONTEÚDO DO DIA */}
                      <div className="flex-1 min-w-0" style={{ padding:"0.5rem 0.7rem" }}>
                        {(d.label || (editMode && canEditActiveTeam) || overlap.samePerson || overlap.partial || overlap.identical) && (
                          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                            {d.label && !editMode && (
                              <Badge T={T} tone="accent">{d.label}</Badge>
                            )}
                            {/* Detector de sobreposição (§6): só a MESMA pessoa em turnos que se
                                sobrepõem é aviso forte — pessoas diferentes em janelas idênticas é
                                cobertura dupla intencional (feriado com dupla escala), sem alarme. */}
                            {overlap.samePerson && (
                              <Badge T={T} tone="danger" icon="alert">mesma pessoa em turnos sobrepostos</Badge>
                            )}
                            {overlap.partial && (
                              <Badge T={T} tone="warn" icon="alert">sobreposição parcial</Badge>
                            )}
                            {overlap.identical && !overlap.samePerson && (
                              <Badge T={T} tone="neutral">cobertura dupla</Badge>
                            )}
                            {editMode && canEditActiveTeam && (
                              <input
                                key={`${dk}-${d.label || ''}`}
                                defaultValue={d.label || ''}
                                placeholder="rótulo do dia (ex.: Feriado)"
                                aria-label={`Rótulo de ${fmtDS(dk)}`}
                                onBlur={e => saveDayLabel(dk, e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                style={{ fontSize:'0.72rem', background:T.inputBg, color:T.textPrimary, border:`1px solid ${T.inputBorder}`, borderRadius:T.rControl, padding:'0.25rem 0.45rem', minHeight:'1.9rem', maxWidth:'13rem' }}
                              />
                            )}
                          </div>
                        )}

                        {/* Semana do ciclo / Folga FDS só existem em equipe com rotação (a
                            sustentação) — infra e desenvolvimento não têm rodízio, então
                            d.cycleWeek vem null e não há nada a mostrar aqui. */}
                        {isWeekend && d.dow === 6 && d.cycleWeek !== null && (
                          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                            <Badge T={T} tone="neutral">Semana {d.cycleWeek} do ciclo</Badge>
                            <Badge T={T} tone="warn" icon="umbrella"
                              style={{ opacity: filter && !d.folga.includes(filter) ? 0.4 : 1 }}>
                              Folga FDS: {d.folga.join(", ")}
                            </Badge>
                          </div>
                        )}

                        {/* TURNOS — ordenados pelo horário real de início; idx é só a
                            chave estável do override, nunca a posição (ver "Dividir turno"). */}
                        <div>
                          {sortShiftsByStart(d.shifts, team.dayStart).map((s) => {
                            const i = s.idx;
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
                                className="flex flex-wrap items-center gap-x-2.5 gap-y-1"
                                style={{
                                  opacity: dim ? 0.32 : 1,
                                  cursor: editMode ? 'pointer' : 'default',
                                  background: isSelected ? T.accentQuiet : 'transparent',
                                  boxShadow: isSelected ? `inset 0 0 0 1px ${T.accent}` : undefined,
                                  borderRadius: T.rControl,
                                  padding: editMode ? '0.35rem 0.4rem' : '0.12rem 0',
                                  margin: editMode ? '0.1rem 0' : undefined,
                                  fontSize: '0.82rem',
                                }}>
                                {editMode && (
                                  <span aria-hidden="true" style={{ width:'0.95rem', height:'0.95rem', borderRadius:'3px', border:`1px solid ${isSelected?T.accent:T.borderStrong}`, background:isSelected?T.accentFill:'transparent', display:'inline-flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                    {isSelected && <Icon name="check" size={11} style={{ color:T.accentInk }} />}
                                  </span>
                                )}
                                <span style={{ width:'5.5rem', flexShrink:0, fontWeight:600, color: highlight ? T.accent : T.textSecondary }}>
                                  {s.period}
                                </span>
                                <span className="tnum" style={{ width:'7rem', flexShrink:0, fontFamily:T.fontMono, fontSize:'0.76rem', color: highlight ? T.accent : T.textMuted }}>
                                  {s.time}
                                </span>
                                <span className="tnum" style={{ width:'2.1rem', flexShrink:0, fontFamily:T.fontMono, fontSize:'0.76rem', color:T.textMuted }}>
                                  {shiftDuration(s.time)}
                                </span>
                                <span className="inline-flex flex-wrap items-center gap-1">
                                  {people.length > 0 ? (
                                    people.map((p, pi) => <PersonTag key={pi} name={p.person} subOf={p.subOf} T={T} dark={dark} />)
                                  ) : canEditActiveTeam && !editMode ? (
                                    <button type="button"
                                      onClick={() => { setEditMode(true); setSelectedShifts(new Set([shiftKey])); }}
                                      style={{ fontSize:'0.72rem', fontWeight:600, color:T.warn, background:T.warnQuiet, border:`1px dashed ${T.warnBorder}`, borderRadius:T.rChip, padding:'0.1rem 0.45rem', cursor:'pointer' }}>
                                      sem plantonista — atribuir
                                    </button>
                                  ) : (
                                    <span style={{ fontSize:'0.78rem', color:T.textMuted, fontStyle:'italic' }}>sem plantonista</span>
                                  )}
                                </span>
                                {recent ? (
                                  <Badge T={T} tone="accent" style={{ marginLeft:'auto' }}>
                                    <span className="tnum">alterado {fmtEdited(ov.editedAt)}</span>
                                  </Badge>
                                ) : (editMode && hasOverride) ? (
                                  <Badge T={T} tone="neutral" style={{ marginLeft:'auto' }}>editado</Badge>
                                ) : null}
                                {editMode && canEditActiveTeam && (
                                  <Button T={T} size="sm" variant="quiet"
                                    onClick={(e) => { e.stopPropagation(); openSplitForm(dk, i, s); }}
                                    title="Dividir este turno em partes"
                                    style={{ marginLeft: (recent || (editMode && hasOverride)) ? undefined : 'auto', minHeight:'1.75rem', padding:'0.15rem 0.45rem', fontSize:'0.68rem' }}>
                                    <Icon name="scissors" size={12} /> Dividir
                                  </Button>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* Adicionar turno ao dia (modo edição) */}
                        {editMode && canEditActiveTeam && (addDay === dk ? (
                          <div className="mt-2 pt-2" style={{ borderTop:`1px dashed ${T.borderStrong}` }}>
                            <div className="grid gap-2 mb-2" style={{ gridTemplateColumns:'repeat(auto-fit, minmax(120px, 1fr))' }}>
                              <input value={addForm.period} onChange={e => setAddForm(f => ({ ...f, period:e.target.value }))} placeholder="Período (ex: Tarde)" aria-label="Período do novo turno" style={{ ...selStyle, marginTop:0 }} />
                              <input value={addForm.time} onChange={e => setAddForm(f => ({ ...f, time:e.target.value }))} placeholder="Horário (ex: 17:00 – 23:00)" aria-label="Horário do novo turno" style={{ ...selStyle, marginTop:0 }} />
                            </div>
                            <div className="mb-2">
                              <PersonPicker selected={addForm.persons} onToggle={n => setAddForm(f => ({ ...f, persons: togglePerson(f.persons, n) }))} roster={team.roster} T={T} dark={dark} />
                            </div>
                            <div className="flex gap-2">
                              <Button T={T} size="sm" variant="primary" onClick={addShift} disabled={editSaving}>
                                {editSaving ? 'Salvando…' : 'Adicionar turno'}
                              </Button>
                              <Button T={T} size="sm" variant="secondary" onClick={() => { setAddDay(null); setEditError(null); }}>
                                Cancelar
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <Button T={T} size="sm" variant="quiet" className="mt-1"
                            onClick={() => { setAddDay(dk); setAddForm({ persons: [], period: '', time: '' }); setEditError(null); }}
                            style={{ marginTop:'0.35rem', border:`1px dashed ${T.border}`, fontSize:'0.72rem' }}>
                            <Icon name="plus" size={12} /> Adicionar turno
                          </Button>
                        ))}

                        {/* Dividir turno (modo edição) — docs/specs/multi-equipe.md §6 */}
                        {editMode && canEditActiveTeam && splitForm?.dk === dk && (
                          <div className="mt-2 pt-2" style={{ borderTop:`1px dashed ${T.borderStrong}` }}>
                            <div style={{ fontSize:'0.78rem', fontWeight:700, color:T.textPrimary, marginBottom:'0.15rem' }}>
                              Dividir turno · {splitForm.originalPeriod} · <span className="tnum">{splitForm.originalTime}</span>
                            </div>
                            <p style={{ fontSize:'0.75rem', color:T.textMuted, margin:'0 0 0.6rem' }}>
                              Pessoas vazias mantêm quem já está na 1ª parte; nas partes novas, viram turno vago.
                            </p>
                            {splitPreview?.error && (
                              <p role="alert" className="flex items-center gap-1.5 mb-2" style={{ color:T.danger, fontSize:'0.75rem', fontWeight:600 }}>
                                <Icon name="alert" size={13} /> {splitPreview.error}
                              </p>
                            )}
                            {splitForm.parts.map((part, pi) => (
                              <div key={pi} className="mb-2 pb-2" style={{ borderBottom: pi < splitForm.parts.length - 1 ? `1px dashed ${T.border}` : 'none' }}>
                                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                                  <span className="tnum" style={{ fontFamily:T.fontMono, fontSize:'0.76rem', fontWeight:700, color:T.textSecondary, minWidth:'7rem' }}>
                                    {splitPreview?.parts?.[pi]?.time || '…'}
                                  </span>
                                  <input value={part.period} onChange={e => updateSplitPart(pi, 'period', e.target.value)}
                                    placeholder="Período (ex: Manhã)" aria-label={`Período da parte ${pi + 1}`}
                                    style={{ ...selStyle, marginTop:0, maxWidth:'11rem' }} />
                                </div>
                                <PersonPicker selected={part.persons} onToggle={n => updateSplitPart(pi, 'persons', togglePerson(part.persons, n))} roster={team.roster} T={T} dark={dark} />
                                {pi < splitForm.cuts.length && (
                                  <div className="flex items-center gap-2 mt-1.5">
                                    <label style={labelStyle} htmlFor={`cut-${dk}-${pi}`}>corte em</label>
                                    <input id={`cut-${dk}-${pi}`} type="time" value={splitForm.cuts[pi]} onChange={e => updateSplitCut(pi, e.target.value)}
                                      style={{ ...selStyle, marginTop:0, width:'8rem' }} />
                                  </div>
                                )}
                              </div>
                            ))}
                            <div className="flex flex-wrap gap-2 mb-2">
                              <Button T={T} size="sm" variant="secondary" onClick={addSplitCut}
                                disabled={splitForm.parts.length >= MAX_SPLIT_PARTS}
                                style={{ borderStyle:'dashed' }}>
                                <Icon name="plus" size={12} /> Adicionar corte
                              </Button>
                              {splitForm.cuts.length > 1 && (
                                <Button T={T} size="sm" variant="quiet" onClick={removeSplitCut}>
                                  Remover último corte
                                </Button>
                              )}
                            </div>
                            <div className="flex gap-2">
                              <Button T={T} size="sm" variant="primary" onClick={applySplit}
                                disabled={editSaving || !!splitPreview?.error}>
                                {editSaving ? 'Salvando…' : `Dividir em ${splitForm.parts.length} partes`}
                              </Button>
                              <Button T={T} size="sm" variant="secondary" onClick={() => { setSplitForm(null); setEditError(null); }}>
                                Cancelar
                              </Button>
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

            {/* ══ SUBSTITUIÇÕES ══════════════════════════════════════════════ */}
            <Panel T={T} style={{ marginTop:"1rem", padding:"0.8rem" }}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <SectionLabel T={T}>Substituições</SectionLabel>
                  {monthSubs.length > 0 && (
                    <Badge T={T} tone="info">
                      <span className="tnum">{monthSubs.length}</span> ativa{monthSubs.length > 1 ? "s" : ""}
                    </Badge>
                  )}
                </div>
                {/* Viewers cannot create substitutions */}
                {profile?.role !== 'viewer' && (
                  <Button T={T} size="sm" variant="secondary"
                    onClick={subForm.show ? () => setSubForm(f => ({ ...f, show:false })) : openSubForm}>
                    {subForm.show ? <><Icon name="x" size={13} /> Cancelar</> : <><Icon name="plus" size={13} /> Adicionar</>}
                  </Button>
                )}
              </div>

              {subError && (
                <p role="alert" className="flex items-center gap-1.5 mb-2" style={{ color:T.danger, fontSize:'0.78rem', fontWeight:600 }}>
                  <Icon name="alert" size={13} /> {subError}
                </p>
              )}

              {monthSubs.length === 0 && !subForm.show && !subsLoading && (
                <p style={{ fontSize:"0.8rem", color:T.textMuted, margin:0 }}>
                  Nenhuma substituição neste mês. Use para férias ou trocas eventuais.
                </p>
              )}
              {subsLoading && <p role="status" style={{ fontSize:"0.8rem", color:T.textMuted, margin:0 }}>Carregando substituições…</p>}

              {monthSubs.map((s, si) => {
                // Show delete only to admin, or to member if they appear in the substitution
                const canDelete = isAdmin
                  || (profile?.role === 'member' && (s.titular === profile?.memberId || s.substituto === profile?.memberId));
                return (
                  <div key={s.id} className="flex items-center justify-between flex-wrap gap-y-1"
                    style={{ borderTop: `1px solid ${T.border}`, padding:"0.4rem 0", marginTop: si === 0 ? "0.5rem" : 0 }}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <PersonTag name={s.titular} T={T} dark={dark} />
                      <Icon name="chevronRight" size={13} style={{ color:T.textMuted }} />
                      <PersonTag name={s.substituto} T={T} dark={dark} />
                      <span className="tnum" style={{ fontFamily:T.fontMono, fontSize:"0.74rem", color:T.textMuted }}>
                        {fmtDS(s.from)} – {fmtDS(s.until)}
                      </span>
                    </div>
                    {canDelete && (
                      <Button T={T} size="sm" variant="quiet" onClick={() => removeSub(s)}
                        aria-label={`Excluir substituição: ${s.substituto} cobre ${s.titular} de ${fmtDS(s.from)} a ${fmtDS(s.until)}`}
                        style={{ width:'2.25rem', minHeight:'2.25rem', padding:0 }}>
                        <Icon name="x" size={15} />
                      </Button>
                    )}
                  </div>
                );
              })}

              {subForm.show && (
                <div className="mt-3 pt-3" style={{ borderTop:`1px solid ${T.border}` }}>
                  <div className="grid gap-3 mb-3" style={{ gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))' }}>
                    <label style={labelStyle}>Titular (ausente)
                      <select value={subForm.titular} onChange={e => setSubForm(f => ({ ...f, titular:e.target.value, substituto: f.substituto===e.target.value?"":f.substituto }))} style={selStyle}>
                        <option value="">Selecionar…</option>
                        {team.roster.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </label>
                    <label style={labelStyle}>Substituto
                      <select value={subForm.substituto} onChange={e => setSubForm(f => ({ ...f, substituto:e.target.value }))} style={selStyle}>
                        <option value="">Selecionar…</option>
                        {team.roster.filter(p => p !== subForm.titular).map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </label>
                    <label style={labelStyle}>De
                      <input type="date" value={subForm.from} onChange={e => setSubForm(f => ({ ...f, from:e.target.value }))} style={selStyle} />
                    </label>
                    <label style={labelStyle}>Até
                      <input type="date" value={subForm.until} onChange={e => setSubForm(f => ({ ...f, until:e.target.value }))} style={selStyle} />
                    </label>
                  </div>
                  <Button T={T} variant="primary" onClick={addSub} disabled={!canSave || subSaving}>
                    {subSaving ? "Salvando…" : "Salvar substituição"}
                  </Button>

                  {coverSuggestions.length > 0 && (
                    <div className="mt-4 pt-3" style={{ borderTop:`1px solid ${T.border}` }}>
                      <SectionLabel T={T} style={{ marginBottom:'0.5rem' }}>
                        {subForm.substituto
                          ? `${subForm.substituto} cobrirá ${coverSuggestions.length} dia${coverSuggestions.length>1?"s":""} de ${subForm.titular || "…"}`
                          : `${coverSuggestions.length} dia${coverSuggestions.length>1?"s":""} a cobrir — quem está livre`}
                      </SectionLabel>
                      <div>
                        {coverSuggestions.slice(0, 12).map((day, i) => (
                          <div key={i} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5"
                            style={{ borderTop: i > 0 ? `1px solid ${T.border}` : "none", padding:"0.35rem 0", fontSize:"0.78rem" }}>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="tnum" style={{ fontFamily:T.fontMono, fontWeight:700, color:T.textSecondary }}>{fmtDate(day.date)}</span>
                              <span style={{ color:T.textMuted }}>{DOW_SHORT[day.dow]}</span>
                              <span style={{ color:T.textSecondary }}>{day.shifts.map(s => s.period).join(" + ")}</span>
                              <span className="tnum" style={{ fontFamily:T.fontMono, fontSize:'0.74rem', color:T.textMuted }}>{day.shifts.map(s => s.time).join(" / ")}</span>
                            </div>
                            {!subForm.substituto && (
                              <span className="inline-flex items-center gap-1" style={{ color: day.available.length ? T.textSecondary : T.danger }}>
                                {day.available.length ? `Livres: ${day.available.join(", ")}` : <><Icon name="alert" size={12} /> Todos ocupados</>}
                              </span>
                            )}
                          </div>
                        ))}
                        {coverSuggestions.length > 12 && (
                          <p style={{ fontSize:"0.75rem", color:T.textMuted, marginTop:"0.35rem" }}>
                            … e mais {coverSuggestions.length - 12} dias
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Panel>

            {/* ══ PAINEL DE EDIÇÃO (sticky) ══════════════════════════════════
                Overlay: sombra, sem borda. Antes carregava borda de 1.5px E
                sombra de 32px — o "ghost card" que o sistema proíbe. */}
            {canEditActiveTeam && editMode && (
              <div style={{ position:'sticky', bottom:'0.75rem', marginTop:'1rem', background:T.surface, borderRadius:T.rPanel, padding:'0.85rem', boxShadow:T.shadowOverlay, zIndex:40 }}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span role="status" style={{ fontWeight:700, fontSize:'0.85rem', color: selectedShifts.size ? T.accent : T.textSecondary }}>
                    {selectedShifts.size === 0
                      ? 'Toque nos turnos do calendário para selecioná-los'
                      : `${selectedShifts.size} turno${selectedShifts.size > 1 ? 's' : ''} selecionado${selectedShifts.size > 1 ? 's' : ''}`}
                  </span>
                  {selectedShifts.size > 0 && (
                    <Button T={T} size="sm" variant="quiet" onClick={() => setSelectedShifts(new Set())}>
                      Limpar seleção
                    </Button>
                  )}
                </div>

                {selectedShifts.size > 0 && (
                  <>
                    <div className="mb-3">
                      <div style={labelStyle}>Pessoas <span style={{ fontWeight:400, color:T.textMuted }}>(vazio = manter as atuais)</span></div>
                      <div className="mt-1">
                        <PersonPicker selected={editForm.persons} onToggle={n => setEditForm(f => ({ ...f, persons: togglePerson(f.persons, n) }))} roster={team.roster} T={T} dark={dark} />
                      </div>
                    </div>
                    <div className="grid gap-3 mb-3" style={{ gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))' }}>
                      <label style={labelStyle}>Período
                        <input value={editForm.period} onChange={e => setEditForm(f => ({ ...f, period:e.target.value }))}
                          placeholder="ex: Madrugada" style={selStyle} />
                      </label>
                      <label style={labelStyle}>Horário
                        <input value={editForm.time} onChange={e => setEditForm(f => ({ ...f, time:e.target.value }))}
                          placeholder="ex: 23:00 – 04:00" style={selStyle} />
                      </label>
                    </div>

                    {/* Toggle: apply to all future months */}
                    <label style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.6rem', cursor:'pointer', userSelect:'none', minHeight:'2.25rem' }}>
                      <input
                        type="checkbox"
                        checked={applyToFuture}
                        onChange={e => setApplyToFuture(e.target.checked)}
                        style={{ width:'1rem', height:'1rem', cursor:'pointer', accentColor:T.accentFill }}
                      />
                      <span style={{ fontSize:'0.8rem', fontWeight:600, color: applyToFuture ? T.accent : T.textSecondary }}>
                        Aplicar a todos os meses seguintes
                      </span>
                      {applyToFuture && futureShiftCount > 0 && (
                        <Badge T={T} tone="warn"><span className="tnum">{futureShiftCount}</span> turno{futureShiftCount > 1 ? 's' : ''}</Badge>
                      )}
                    </label>
                    {applyToFuture && (
                      <p className="flex items-center gap-1.5" style={{ fontSize:'0.75rem', color:T.warn, fontWeight:600, margin:'0 0 0.6rem 0' }}>
                        <Icon name="alert" size={13} /> Mudança permanente — afeta todos os meses até o fim da escala
                      </p>
                    )}

                    {editSubConflicts.length > 0 && (
                      <div role="alert" style={{ display:'flex', gap:'0.5rem', alignItems:'flex-start', background:T.warnQuiet, border:`1px solid ${T.warnBorder}`, borderRadius:T.rControl, padding:'0.55rem 0.7rem', margin:'0 0 0.6rem 0' }}>
                        <Icon name="alert" size={14} style={{ color:T.warn, flexShrink:0, marginTop:'0.1rem' }} />
                        <div style={{ fontSize:'0.74rem', color:T.textSecondary, lineHeight:1.55 }}>
                          <b style={{ color:T.warn }}>Conflito com substituição.</b>{' '}
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
                      <Button T={T} variant="primary" onClick={applyEditOverrides} disabled={editSaving}>
                        {editSaving ? (editProgress || 'Salvando…') : applyToFuture ? `Aplicar a ${futureShiftCount} turnos` : 'Aplicar alteração'}
                      </Button>
                      <Button T={T} variant="danger" onClick={resetSelectedShifts} disabled={editSaving}>
                        {editSaving ? (editProgress || 'Salvando…') : applyToFuture ? `Resetar ${futureShiftCount} turnos` : 'Resetar para padrão'}
                      </Button>
                    </div>
                    {editError && (
                      <p role="alert" className="flex items-center gap-1.5" style={{ color:T.danger, fontSize:'0.76rem', fontWeight:600, marginTop:'0.5rem' }}>
                        <Icon name="alert" size={13} /> {editError}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            <footer style={{ marginTop:"1rem", fontSize:"0.72rem", color:T.footerText, lineHeight:1.6 }}>
              Escala seg–sex fixa · rodízio de fim de semana em escada de 6 semanas (a partir de 18/07/2026) · 4 de plantão + 2 de folga
            </footer>
          </div>

          {/* ══ BARRA LATERAL — estado e lentes ═══════════════════════════════ */}
          <aside className="order-1 lg:order-2 flex flex-col gap-3 lg:sticky" style={{ top:"3.5rem" }}>

            {/* AGORA — a resposta de 5 segundos (PRODUCT.md, princípio 1).
                Sempre as três equipes, ignorando o seletor, cada uma com o
                PRÓPRIO dayStart (ver ADR-0002). */}
            <Panel T={T} style={{ padding:"0.75rem 0.8rem" }} aria-label="Plantão agora">
              <div className="flex items-baseline justify-between gap-2 mb-2">
                <SectionLabel T={T}>Agora</SectionLabel>
                <span className="tnum" style={{ fontFamily:T.fontMono, fontSize:"0.74rem", color:T.textMuted }}>
                  {DOW_SHORT[now.getDay()]} {fmtDate(now)} · {nowTime}
                </span>
              </div>

              <div className={scheduleReady ? "settle-in" : undefined}>
                {nowRows.map(row => {
                  const info = rowInfo(row);
                  return (
                    <div key={row.team.id} className="flex items-center gap-2"
                      style={{ padding:"0.3rem 0", borderTop:`1px solid ${T.border}` }}>
                      <span style={{ width:7, height:7, borderRadius:"50%", flexShrink:0, background:info.dotColor }} />
                      <span style={{ width:"5.4rem", flexShrink:0, fontSize:"0.72rem", color:T.textMuted }}>
                        {row.team.nome}
                      </span>
                      <span className="truncate" style={{ fontSize:"0.82rem", fontWeight:600, color:info.tone }}>
                        {info.text}
                      </span>
                      {info.until && (
                        <span className="tnum" style={{ marginLeft:"auto", flexShrink:0, fontFamily:T.fontMono, fontSize:"0.72rem", color:T.textMuted }}>
                          até {info.until}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Handoff: plantonista anterior e próximo, da equipe SELECIONADA */}
              {scheduleReady && (handoff.anterior || handoff.proximo) && (
                <div style={{ marginTop:"0.6rem", paddingTop:"0.5rem", borderTop:`1px solid ${T.border}` }}>
                  <div style={{ fontSize:"0.68rem", color:T.textMuted, marginBottom:"0.25rem" }}>
                    Passagem de turno · {team.nome}
                  </div>
                  {[
                    { label:"antes",  data:handoff.anterior, prefix:"até " },
                    { label:"depois", data:handoff.proximo,  prefix:"" },
                  ].map(({ label, data, prefix }) => (
                    <div key={label} className="flex items-center gap-2" style={{ fontSize:"0.8rem", padding:"0.15rem 0" }}>
                      <span style={{ width:"3rem", flex:"none", fontSize:"0.72rem", color:T.textMuted }}>{label}</span>
                      {data ? (
                        <>
                          <span style={{ width:7, height:7, borderRadius:"50%", flex:"none", background: data.people.length === 1 ? memberTone(data.people[0], dark).dot : T.textSecondary }} />
                          <span style={{ fontWeight:600, color:T.textSecondary }} className="truncate">
                            {data.people.length ? data.people.join(" / ") : "vago"}
                          </span>
                          <span className="tnum" style={{ marginLeft:"auto", flexShrink:0, fontFamily:T.fontMono, fontSize:"0.72rem", color:T.textMuted }}>
                            {prefix}{data.hora}
                          </span>
                        </>
                      ) : (
                        <span style={{ color:T.textMuted }}>—</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            {/* FILTRO — limitado ao roster da equipe selecionada */}
            <Panel T={T} style={{ padding:"0.75rem 0.8rem" }} aria-label="Filtro por responsável">
              <SectionLabel T={T} style={{ marginBottom:"0.5rem" }}>Filtrar por responsável</SectionLabel>
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => { setFilter(null); saveProfile({ filter: null }); }}
                  aria-pressed={!filter}
                  style={{
                    fontSize:'0.75rem', fontWeight:600, padding:'0.3rem 0.55rem', minHeight:'2.1rem',
                    borderRadius:T.rControl, cursor:'pointer',
                    background: !filter ? T.accentFill : 'transparent',
                    color: !filter ? T.accentInk : T.textSecondary,
                    border:`1px solid ${!filter ? T.accentFill : T.border}`,
                  }}>
                  Todos
                </button>
                {team.roster.map(name => {
                  const tone = memberTone(name, dark);
                  const on = filter === name;
                  const temSubHoje = activeTitulares.has(name);
                  return (
                    <button key={name} onClick={() => handleFilterChange(name)} aria-pressed={on}
                      className="inline-flex items-center gap-1.5"
                      style={{
                        fontSize:'0.75rem', fontWeight:600, padding:'0.3rem 0.55rem', minHeight:'2.1rem',
                        borderRadius:T.rControl, cursor:'pointer',
                        background: on ? tone.tint : 'transparent',
                        color: on ? tone.ink : T.textSecondary,
                        border:`1px solid ${on ? tone.ink : T.border}`,
                      }}>
                      <span style={{ width:7, height:7, borderRadius:'50%', flexShrink:0, background:tone.dot, opacity: on ? 1 : 0.55 }} />
                      {name}
                      {temSubHoje && <Icon name="umbrella" size={12} />}
                    </button>
                  );
                })}
              </div>
              {activeTitulares.size > 0 && (
                <p className="flex items-start gap-1.5" style={{ fontSize:"0.72rem", color:T.textMuted, marginTop:"0.5rem", lineHeight:1.5 }}>
                  <Icon name="umbrella" size={12} style={{ flexShrink:0, marginTop:'0.15rem' }} />
                  <span>= com substituição ativa hoje (ausente, coberto por outra pessoa)</span>
                </p>
              )}
            </Panel>

            {/* PRÓXIMOS PLANTÕES da pessoa filtrada */}
            {filter && (
              <Panel T={T} style={{ padding:"0.75rem 0.8rem" }}>
                <div className="flex items-center gap-2 mb-2">
                  <span style={{ width:8, height:8, borderRadius:"50%", background:memberTone(filter, dark).dot, flexShrink:0 }} />
                  <SectionLabel T={T}>Próximos sobreavisos de {filter}</SectionLabel>
                </div>
                {upcoming.length === 0 ? (
                  <p style={{ fontSize:"0.8rem", color:T.textMuted, margin:0 }}>Nenhum plantão encontrado no período.</p>
                ) : (
                  <div>
                    {upcoming.map((u, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 flex-wrap"
                        style={{ borderTop: i>0?`1px solid ${T.border}`:"none", padding:"0.3rem 0", opacity: u.coveredBy ? 0.5 : 1, fontSize:"0.78rem" }}>
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          <span className="tnum" style={{ fontFamily:T.fontMono, fontWeight:700, color:T.textSecondary }}>{fmtDate(u.date)}</span>
                          <span style={{ color:T.textMuted, width:"1.9rem" }}>{DOW_SHORT[u.dow]}</span>
                          {u.kind === "folga" ? (
                            <Badge T={T} tone="warn" icon="umbrella">Folga FDS</Badge>
                          ) : (
                            <span style={{ fontWeight:600, color:memberTone(filter, dark).ink }}>{u.period}</span>
                          )}
                          {u.coveringFor && <Badge T={T} tone="info">cobre {u.coveringFor}</Badge>}
                          {u.coveredBy  && <Badge T={T} tone="neutral">coberto por {u.coveredBy}</Badge>}
                        </div>
                        <span className="tnum" style={{ fontFamily:T.fontMono, fontSize:"0.74rem", color:T.textMuted, flexShrink:0 }}>
                          {u.time}{shiftDuration(u.time)?` · ${shiftDuration(u.time)}`:""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            )}
          </aside>
        </div>
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
