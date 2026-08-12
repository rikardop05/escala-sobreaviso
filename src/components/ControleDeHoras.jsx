import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useApi } from '../lib/api';
import { MONTHS, durationHours, fmtHM, brl, buildSchedule } from '../lib/schedule';
import { parseShiftTime, scheduleEntriesFor, monthTotals, isEntryCountable, splitHoraExtra } from '../lib/chCalc';
import { TEAMS, MEMBERS, chGroupsFor } from '../lib/teams';
import { getTheme, memberTone } from '../lib/theme';
import { Icon, Button, Badge, Panel, SectionLabel, SaveStatus, Snackbar, ConfirmDialog, friendlyError } from './ui';
import RelatorioConsolidado from './RelatorioConsolidado';
import AprovacaoPendencias from './AprovacaoPendencias';

const TYPES = ["Hora Extra", "Compensação"];

// Tipo de lançamento → tom semântico do sistema (src/lib/theme.js). Antes eram
// pares de hex escolhidos à mão, um par por tema (`color`/`bg` + `lightColor`/
// `lightBg`), o que obrigava cada leitor a escolher o par certo e deixava valor
// de tema claro (#FEF9C3, #431407…) renderizado no escuro quando alguém
// esquecia. O tom vem de T, que já troca com o tema.
//   Sobreaviso  → info    (automático, vem da escala)
//   Hora Extra  → success (acresce à NF)
//   Compensação → warn    (abate da NF)
// `danger` fica reservado a erro e a Hora Extra rejeitada.
const TYPE_TONE = {
  Sobreaviso:   'info',
  "Hora Extra": 'success',
  Compensação:  'warn',
};

// Só Hora Extra tem status — Sobreaviso e Compensação nunca passam por aprovação.
const STATUS_META = {
  aprovado:  { label: "Aprovado",  tone: 'success' },
  pendente:  { label: "Pendente",  tone: 'warn' },
  rejeitado: { label: "Rejeitado", tone: 'danger' },
};

// Resolve um tom em tinta/fundo/borda. Mesma tabela do Badge em ui.jsx, exposta
// aqui porque os cartões de total e a legenda da tabela não são badges.
function toneColors(T, tone) {
  return {
    accent:  { fg: T.accent,     bg: T.accentQuiet,  border: T.accentBorder },
    success: { fg: T.success,    bg: T.successQuiet, border: T.successBorder },
    warn:    { fg: T.warn,       bg: T.warnQuiet,    border: T.warnBorder },
    danger:  { fg: T.danger,     bg: T.dangerQuiet,  border: T.dangerBorder },
    info:    { fg: T.info,       bg: T.infoQuiet,    border: T.infoBorder },
    neutral: { fg: T.textMuted,  bg: T.surfaceHover, border: T.border },
  }[tone] || { fg: T.textMuted, bg: T.surfaceHover, border: T.border };
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

  // Fechamento mensal — { 'YYYY-MM': { closedAt, closedBy, params, totals, entries } }
  const [closedMonths, setClosedMonths] = useState({});
  const [closeDialog,  setCloseDialog]  = useState(null); // 'close' | 'reopen' | null
  const [closeBusy,    setCloseBusy]    = useState(false);
  const [closeError,   setCloseError]   = useState(null);

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

  // Remuneração fica oculta por padrão (estilo app de banco) — olho revela, lápis edita.
  // Puramente visual: não afeta params/persistência. Reseta ao trocar de pessoa (admin)
  // para nunca deixar o salário de um colega exposto sem querer.
  const [remuneracaoVisible, setRemuneracaoVisible] = useState(false);
  const [remuneracaoEditing, setRemuneracaoEditing] = useState(false);
  // Valor da NF (remuneração + SA + HE − Compensação) — mesma proteção da remuneração,
  // mas só olho (sem edição, é um valor derivado). Reseta ao trocar de pessoa.
  const [nfVisible, setNfVisible] = useState(false);

  // Admin pode trocar para qualquer membro das equipes em adminOf (agrupado por
  // equipe no dropdown — ver chGroupsFor); member trava no próprio painel. Admin
  // fora da escala (sem memberId) cai no primeiro membro do primeiro grupo por
  // padrão — assim o painel já abre com dados em vez de um dropdown "fantasma".
  const chGroups = useMemo(() => chGroupsFor(profile?.adminOf), [profile]);
  // Relatório consolidado (admin): substitui a vista de uma pessoa por vez pela
  // tabela de todas as pessoas das equipes em adminOf no mês selecionado.
  const [showReport, setShowReport] = useState(false);
  const chPeopleFlat = useMemo(() => chGroups.flatMap(g => g.people), [chGroups]);
  const [viewPerson, setViewPerson] = useState(profile?.memberId ?? (isAdmin ? (chPeopleFlat[0] ?? null) : null));
  const person = isAdmin ? (viewPerson ?? profile?.memberId) : profile?.memberId;
  // A equipe da pessoa selecionada determina TUDO daqui pra baixo: escala, overrides,
  // labels e substituições vêm sempre da equipe dela (MEMBERS[person].teamId), nunca
  // fixas na sustentação (docs/specs/multi-equipe.md §5, Fase 2).
  const personTeamId = person ? MEMBERS[person]?.teamId : null;
  const team = personTeamId ? TEAMS[personTeamId] : null;

  const [monthIdx, setMonthIdx] = useState(now.getMonth());
  const [year,     setYear]     = useState(now.getFullYear());
  const [editId,   setEditId]   = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const blank = { tipo: "Hora Extra", data: "", inicio: "", fim: "", projeto: "", atividade: "" };
  const [form, setForm] = useState(blank);

  // Recarrega dados do CH quando a pessoa (e portanto a equipe dela) muda — a
  // escala/overrides/labels/substituições vêm sempre da equipe de `person`, nunca
  // de uma equipe fixa (Fase 2 — antes carregava uma vez só, sem equipe nenhuma).
  useEffect(() => {
    if (!person || !personTeamId) { setDataLoading(false); return; }
    setDataLoading(true);
    const query = isAdmin && person ? `?person=${encodeURIComponent(person)}` : '';
    Promise.all([
      api(`/api/ch${query}`),
      api(`/api/substitutions?team=${personTeamId}`),
      api(`/api/schedule?team=${personTeamId}`),
      api(`/api/ch-close${query}`).catch(() => ({})), // fechamentos são opcionais — falha não bloqueia o painel
    ]).then(([chData, subData, overridesData, closedData]) => {
      setEntries(chData.entries || []);
      setParamsByPerson(chData.params || {});
      setSubs(subData || []);
      setOverrides(overridesData?.overrides || {});
      setClosedMonths(closedData || {});
    }).catch(console.error)
      .finally(() => setDataLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person, personTeamId]);

  useEffect(() => () => {
    clearTimeout(entriesTimer.current);
    clearTimeout(paramsTimer.current);
    clearTimeout(paramsDebounce.current);
    clearTimeout(undoTimer.current);
  }, []);

  useEffect(() => {
    setRemuneracaoVisible(false);
    setRemuneracaoEditing(false);
    setNfVisible(false);
  }, [person]);

  const startEditingRemuneracao = () => {
    setRemuneracaoVisible(true);
    setRemuneracaoEditing(true);
  };
  const finishEditingRemuneracao = () => {
    setRemuneracaoEditing(false);
    setRemuneracaoVisible(false);
  };

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
      const res = await api('/api/ch', { method: 'POST', body });
      // O servidor pode reclassificar Hora Extra (aprovar/pender, dividir em N
      // partes com ids novos) — sincroniza com a versão gravada em vez de manter
      // o lançamento otimista enviado, que nunca tem `status` e por isso cairia
      // na regra de compatibilidade "ausente = aprovado" indevidamente.
      if (Array.isArray(res?.entries)) setEntries(res.entries);
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

  // Campo e rótulo de formulário — tokens do sistema, raio de controle (5px) em
  // vez do 0.5rem antigo. Altura mínima de 2.5rem preserva o alvo de toque.
  const inputStyle = {
    background: T.inputBg, color: T.textPrimary,
    border: `1px solid ${T.inputBorder}`,
    borderRadius: T.rControl, padding: "0.45rem 0.55rem", minHeight: "2.5rem",
    fontSize: "0.82rem", width: "100%",
    transition: "border-color 0.15s",
  };
  const labelStyle = { fontSize: "0.72rem", fontWeight: 600, color: T.labelColor, display: "block", marginBottom: "0.25rem" };
  // Botão quadrado de ícone (olho, lápis, confirmar) — 2.5rem de lado.
  const iconBtnStyle = { width: "2.5rem", padding: 0, flexShrink: 0 };

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
  // buildSchedule já recorta pela vigência da equipe (team.startsOn/endsOn) — nenhum
  // sobreaviso é gerado antes disso, sem precisar de nenhuma lógica extra aqui.
  const schedule = useMemo(() => (team ? buildSchedule(team, overrides) : []), [team, overrides]);

  const scheduleEntries = useMemo(
    () => scheduleEntriesFor(schedule, subs, person, monthIdx, year),
    [schedule, person, monthIdx, year, subs]
  );

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
  // Hora Extra pendente ou rejeitada NÃO entra no total — só aprovada (ou
  // legada, sem status) conta. displayEntries continua mostrando TODAS pra
  // pessoa entender o que está pendente; só o cálculo financeiro filtra.
  const totals = useMemo(
    () => monthTotals(allMonthEntries.filter(isEntryCountable), valorHora),
    [allMonthEntries, valorHora]
  );

  // ─── FECHAMENTO MENSAL ─────────────────────────────────────────────────────
  // Mês fechado = snapshot imutável (params + totais + line items) gravado pelo admin.
  // A UI passa a exibir o snapshot e bloqueia novos lançamentos naquele mês.
  const monthKeyStr = `${year}-${String(monthIdx + 1).padStart(2, '0')}`;
  const closedSnap = closedMonths[monthKeyStr] || null;
  const isClosed = !!closedSnap;
  // Mês anterior ao startsOn da equipe: zero SA é esperado (a equipe não existia
  // ainda), não "turno descoberto" — diferencia isso de um mês simplesmente vazio.
  const monthBeforeTeamStart = !!(team?.startsOn && monthKeyStr < team.startsOn.slice(0, 7));

  const displayEntries = useMemo(() => (
    isClosed
      ? closedSnap.entries.map(e => ({ ...e, person, _fromSchedule: e.origem === 'Escala' }))
      : allMonthEntries
  ), [isClosed, closedSnap, allMonthEntries, person]);

  const displayTotals    = isClosed ? closedSnap.totals : totals;
  const displayValorHora = isClosed ? closedSnap.totals.valorHora : valorHora;
  const displayRemuneracao = isClosed ? (Number(closedSnap.params.remuneracao) || 0) : (Number(params.remuneracao) || 0);
  // Valor da NF = remuneração mensal + SA + HE − Compensação. Snapshots antigos (antes
  // desta feature) não têm valorComp no totals — trata como 0 pra não gerar NaN.
  const valorNF = displayRemuneracao + displayTotals.valorSobreaviso + displayTotals.valorExtra - (displayTotals.valorComp || 0);

  const fmtClosedAt = (iso) => {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  };

  const closeMonth = async () => {
    setCloseBusy(true);
    setCloseError(null);
    try {
      const snapshot = {
        params: { remuneracao: params.remuneracao === '' ? 0 : params.remuneracao, jornada: params.jornada },
        totals: { ...totals, valorHora },
        // Pendente/rejeitada não entra no snapshot — o fechamento já foi
        // recusado pelo servidor se sobrasse alguma (api/ch-close.js), então na
        // prática este filtro só tira Hora Extra rejeitada da fotografia final.
        entries: allMonthEntries.filter(isEntryCountable).map(e => ({
          id: e.id, tipo: e.tipo, data: e.data, inicio: e.inicio, fim: e.fim,
          projeto: e.projeto || '', atividade: e.atividade || '',
          origem: e._fromSchedule ? 'Escala' : 'Manual',
        })),
      };
      const updated = await api('/api/ch-close', { method: 'POST', body: { person, month: monthKeyStr, snapshot } });
      setClosedMonths(updated);
    } catch (e) {
      let parsed = null;
      try { parsed = JSON.parse(e.message); } catch { /* não era JSON */ }
      if (parsed?.error === 'Pending entries') {
        const lista = parsed.pendentes.map(p => `${p.data.slice(8, 10)}/${p.data.slice(5, 7)} ${p.inicio}–${p.fim}`).join(', ');
        setCloseError(`Há Hora Extra pendente de aprovação neste mês: ${lista}. Aprove ou rejeite antes de fechar.`);
      } else if (/already closed|409/i.test(String(e.message))) {
        setCloseError('Este mês já está fechado.');
      } else {
        setCloseError(friendlyError(e));
      }
    } finally {
      setCloseBusy(false);
    }
  };

  const reopenMonth = async () => {
    setCloseBusy(true);
    setCloseError(null);
    try {
      const updated = await api(`/api/ch-close?person=${encodeURIComponent(person)}&month=${monthKeyStr}`, { method: 'DELETE' });
      setClosedMonths(updated);
    } catch (e) {
      setCloseError(friendlyError(e));
    } finally {
      setCloseBusy(false);
    }
  };

  // ─── AÇÕES ─────────────────────────────────────────────────────────────────
  const submit = async () => {
    if (!form.data || !form.inicio || !form.fim || submitting) return;
    if (closedMonths[form.data.slice(0, 7)]) return; // mês fechado — bloqueado (aviso no formulário)
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
    // Mês fechado exporta o snapshot congelado — não o recálculo atual
    const csvParams = isClosed ? closedSnap.params : params;
    // Status entra na linha (transparência — inclui pendente/rejeitada, que não
    // contam no RESUMO abaixo); só existe de fato para Hora Extra.
    const header = ["Data","Tipo","Status","Origem","Início","Fim","Duração (h)","Duração (h:mm)","Projeto","Atividade / Descrição","Responsável"];
    const rows = displayEntries.map(e => {
      const h = durationHours(e.inicio, e.fim);
      const statusLabel = e.tipo === "Hora Extra" ? (STATUS_META[e.status || "aprovado"]?.label || "") : "";
      return [
        e.data, e.tipo, statusLabel,
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
      ...(isClosed ? [["MÊS FECHADO", `em ${fmtClosedAt(closedSnap.closedAt)}`, `por ${closedSnap.closedBy}`]] : []),
      ["Remuneração mensal", brl(Number(csvParams.remuneracao) || 0)],
      ["Jornada (h)", String(csvParams.jornada)],
      ["Valor hora", brl(displayValorHora)],
      ["Horas sobreaviso (escala)", fmtHM(displayTotals.sobreaviso)],
      ["Horas extra", fmtHM(displayTotals.extra)],
      ["Horas compensação", fmtHM(displayTotals.comp)],
      ...(displayTotals.overlapMin > 0 ? [["Sobreposição descontada", `${fmtHM(displayTotals.overlapMin / 60)} (períodos em comum contados uma vez)`]] : []),
      ["Valor sobreaviso (÷3)", brl(displayTotals.valorSobreaviso)],
      ["Valor hora extra (×1,5)", brl(displayTotals.valorExtra)],
      ["VALOR TOTAL", brl(displayTotals.valorTotal)],
      ["Valor compensação (÷3, abate da NF)", brl(displayTotals.valorComp || 0)],
      ["VALOR DA NF", brl((Number(csvParams.remuneracao) || 0) + displayTotals.valorSobreaviso + displayTotals.valorExtra - (displayTotals.valorComp || 0))],
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

  // Tom da pessoa selecionada — OKLCH com lightness fixa por tema (memberTone),
  // não mais o par color/bg do Material, que sumia no escuro.
  const p = memberTone(person, dark);
  const years = [year - 1, year, year + 1];
  const liveDuration = durationHours(form.inicio, form.fim);
  const crossesMidnight = form.inicio && form.fim && form.fim <= form.inicio;
  const formMonthClosed = !!(form.data && closedMonths[form.data.slice(0, 7)]);

  // Prévia da aprovação automática — o cliente só MOSTRA, o servidor é quem de
  // fato classifica no POST (ver api/ch.js). Mesma função dos dois lados
  // (splitHoraExtra em src/lib/chCalc.js) para a prévia nunca prometer algo
  // que o servidor depois não confirma.
  const splitPreview = useMemo(() => {
    if (form.tipo !== 'Hora Extra' || !form.data || !form.inicio || !form.fim || !team) return null;
    return splitHoraExtra(schedule, subs, team.dayStart, person, form.data, form.inicio, form.fim);
  }, [form.tipo, form.data, form.inicio, form.fim, schedule, subs, team, person]);

  const splitSummary = useMemo(() => {
    if (!splitPreview || !splitPreview.length) return null;
    const pendentes = splitPreview.filter(p => !p.aprovado);
    if (pendentes.length === 0) return { pending: false, text: 'Dentro do sobreaviso — será aprovada automaticamente.' };
    if (pendentes.length === splitPreview.length) return { pending: true, text: 'Fora do sobreaviso — ficará pendente até um admin aprovar.' };
    const partsTxt = splitPreview.map(p => `${fmtHM(durationHours(p.inicio, p.fim))} ${p.aprovado ? 'aprovada' : 'pendente'}`).join(' + ');
    return { pending: true, text: `Vai gerar ${splitPreview.length} lançamentos: ${partsTxt}.` };
  }, [splitPreview]);
  const canSubmit = !!(form.data && form.inicio && form.fim) && !submitting && !formMonthClosed;

  const thStyle = { textAlign: "left", fontSize: "0.68rem", fontWeight: 600, color: T.labelColor, padding: "0.5rem 0.5rem", whiteSpace: "nowrap" };

  return (
    <div style={{ minHeight:"100vh", background:T.pageBg, fontFamily:T.fontSans, color:T.textPrimary }}>
      <div className="mx-auto px-3 sm:px-4 py-4" style={{ maxWidth: showReport ? "1440px" : "1100px" }}>

        {/* CABEÇALHO — sem bloco colorido nem texto branco forçado. O antigo era
            um gradiente decorativo com `text-white` nos DOIS temas, o que no tema
            claro dependia de o cabeçalho ser escuro; agora usa os tokens de texto
            como todo o resto da tela. */}
        <header className="flex items-baseline flex-wrap gap-x-3 gap-y-1 mb-4">
          <h1 style={{ fontSize:"1.15rem", fontWeight:700, letterSpacing:"-0.01em", color:T.textPrimary, margin:0 }}>
            {showReport ? "Relatório consolidado" : "Controle de Horas"}
          </h1>
          <span className="tnum" style={{ fontSize:"0.95rem", fontWeight:600, color:T.textSecondary }}>
            {MONTHS[monthIdx]} de {year}
          </span>
          {!showReport && isClosed && (
            <Badge T={T} tone="success" icon="check">Mês fechado</Badge>
          )}
          <span style={{ fontSize:"0.78rem", color:T.textMuted, flexBasis:"100%" }}>
            {showReport ? "Todas as pessoas das suas equipes" : "Sobreaviso (escala automática) + horas extra e compensação"}
          </span>
        </header>

        {!showReport && dataLoading && (
          <Panel T={T} role="status" style={{ padding:"0.85rem", marginBottom:"1rem", textAlign:"center", fontSize:"0.85rem", color:T.textMuted }}>
            Carregando lançamentos e parâmetros…
          </Panel>
        )}

        {/* SELETORES */}
        <div className="flex flex-wrap gap-3 mb-4 items-end">
          {!showReport && (
            <div>
              <label style={labelStyle} htmlFor="ch-person">Responsável</label>
              {isAdmin ? (
                <select id="ch-person" style={{ ...inputStyle, width:'auto' }} value={viewPerson || ''} onChange={e => { setViewPerson(e.target.value); setEditId(null); setForm(blank); }}>
                  {chGroups.map(g => (
                    <optgroup key={g.teamId} label={g.nome}>
                      {g.people.map(name => <option key={name} value={name}>{name}</option>)}
                    </optgroup>
                  ))}
                </select>
              ) : (
                // Tinta sobre tinta-clara da própria matiz. Antes era branco
                // sobre p.ink: no tema escuro a matiz é clara (L .79), então
                // texto branco em cima ficava perto de 1,3:1.
                <div className="inline-flex items-center gap-2"
                  style={{ background: p.tint, color: p.ink, border:`1px solid ${p.ink}`, borderRadius:T.rControl, padding:"0.3rem 0.6rem", minHeight:"2.25rem", fontSize:"0.85rem", fontWeight:600 }}>
                  <span style={{ width:7, height:7, borderRadius:"50%", background:p.dot, flexShrink:0 }} />
                  {person}
                </div>
              )}
            </div>
          )}
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
          {isAdmin && (
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              <AprovacaoPendencias dark={dark} profile={profile} />
              {/* Alternar de vista é navegação, não estado positivo — por isso
                  não usa o verde. Verde fica reservado a sucesso/aprovado. */}
              <Button T={T} size="sm" variant={showReport ? 'primary' : 'secondary'}
                onClick={() => setShowReport(s => !s)}>
                <Icon name={showReport ? "x" : "calendar"} size={15} />
                {showReport ? "Voltar ao painel individual" : "Relatório consolidado"}
              </Button>
            </div>
          )}
        </div>

        {showReport ? (
          <RelatorioConsolidado dark={dark} profile={profile} monthIdx={monthIdx} year={year} />
        ) : (
        <>
        {/* PARÂMETROS */}
        <section className="mb-3" style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:T.rPanel, padding:"0.8rem" }}>
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <h2 className="text-sm font-semibold" style={{ color:T.textSecondary }}>Parâmetros de {person}</h2>
            <SaveStatus status={paramsStatus} onRetry={retryParams} T={T} />
          </div>
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label style={labelStyle} htmlFor="ch-remun">Remuneração mensal (R$)</label>
              {remuneracaoEditing ? (
                <div className="flex items-center gap-1.5">
                  <input id="ch-remun" type="number" autoFocus style={{ ...inputStyle, width:"9rem" }} value={params.remuneracao} placeholder="0,00"
                    onChange={e => setParam("remuneracao", e.target.value === '' ? '' : Number(e.target.value))}
                    onKeyDown={e => { if (e.key === 'Enter') finishEditingRemuneracao(); }} />
                  <button type="button" onClick={finishEditingRemuneracao} aria-label="Concluir edição da remuneração"
                    style={{ background:T.saveBg, color:T.saveColor, border:"none", borderRadius:"0.5rem", width:"2.5rem", height:"2.5rem", flexShrink:0, display:"inline-flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}>
                    <Icon name="check" size={15} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span style={{ ...inputStyle, width:"9rem", display:"inline-flex", alignItems:"center", color: remuneracaoVisible ? T.textPrimary : T.textMuted }}>
                    {remuneracaoVisible ? (Number(params.remuneracao) > 0 ? brl(Number(params.remuneracao)) : "—") : "R$ ••••••"}
                  </span>
                  <button type="button" onClick={() => setRemuneracaoVisible(v => !v)} aria-label={remuneracaoVisible ? "Ocultar remuneração" : "Mostrar remuneração"}
                    style={{ background:"transparent", color:T.textMuted, border:`1px solid ${T.cardBorder}`, borderRadius:"0.5rem", width:"2.5rem", height:"2.5rem", flexShrink:0, display:"inline-flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}>
                    <Icon name={remuneracaoVisible ? "eyeOff" : "eye"} size={15} />
                  </button>
                  <button type="button" onClick={startEditingRemuneracao} aria-label="Editar remuneração"
                    style={{ background:"transparent", color:T.textMuted, border:`1px solid ${T.cardBorder}`, borderRadius:"0.5rem", width:"2.5rem", height:"2.5rem", flexShrink:0, display:"inline-flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}>
                    <Icon name="pencil" size={14} />
                  </button>
                </div>
              )}
            </div>
            <div>
              <label style={labelStyle} htmlFor="ch-jornada">Jornada (h)</label>
              <input id="ch-jornada" type="number" style={{ ...inputStyle, width:"6rem" }} value={params.jornada}
                onChange={e => setParam("jornada", Number(e.target.value))} />
            </div>
            <div className="ml-auto text-right">
              <div className="text-xs" style={{ color:T.labelColor }}>Valor hora <span style={{ color:T.textMuted }}>(remuneração ÷ jornada)</span></div>
              <div className="text-lg font-bold" style={{ color:p.ink }}>{valorHora > 0 ? brl(valorHora) : "—"}</div>
            </div>
          </div>
          {isClosed && (
            <p className="flex items-center gap-1.5 text-xs mt-2" style={{ color:T.textMuted }}>
              <Icon name="check" size={12} />
              O relatório de {MONTHS[monthIdx]} usa os valores congelados no fechamento (valor hora {brl(displayValorHora)}). Alterar os parâmetros acima só afeta meses abertos.
            </p>
          )}
        </section>

        {/* FORMULÁRIO — só HE e Compensação */}
        <section className="mb-3" style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:T.rPanel, padding:"0.8rem" }}>
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
          {formMonthClosed && (
            <p role="alert" className="flex items-center gap-1.5 text-xs font-semibold mb-3" style={{ color:T.warn }}>
              <Icon name="alert" size={13} />
              {form.data.slice(0,7).split('-').reverse().join('/')} está fechado para lançamentos. Peça ao admin para reabrir o mês se precisar alterar.
            </p>
          )}
          {crossesMidnight && (
            <p className="flex items-center gap-1.5 text-xs font-semibold mb-3" style={{ color:T.warn }}>
              <Icon name="alert" size={13} />
              Fim antes do início: será registrado como turno que atravessa a meia-noite ({fmtHM(liveDuration)} de duração). Confira antes de salvar.
            </p>
          )}
          {splitSummary && (
            <p className="flex items-center gap-1.5 text-xs font-semibold mb-3" style={{ color: splitSummary.pending ? T.warn : T.textMuted }}>
              <Icon name="alert" size={13} />
              {splitSummary.text}
            </p>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Desabilitado não pinta um fundo cinza com texto apagado em cima
                (o par T.border + T.textMuted dava 4,47:1, abaixo de AA): mantém
                a superfície e baixa a opacidade do controle inteiro. */}
            <Button T={T} variant="primary" onClick={submit} disabled={!canSubmit}>
              {submitting ? "Salvando…" : editId ? "Salvar alterações" : "Adicionar lançamento"}
            </Button>
            {editId && (
              <Button T={T} variant="secondary" onClick={() => { setEditId(null); setForm(blank); }}>
                Cancelar
              </Button>
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
        <section className="mb-3" style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:T.rPanel, padding:"0.8rem" }}>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="text-sm font-semibold" style={{ color:T.textSecondary }}>Relatório do mês</h2>
            <div className="flex items-center gap-2 flex-wrap">
              {isAdmin && !dataLoading && (
                isClosed ? (
                  <button onClick={() => setCloseDialog('reopen')} disabled={closeBusy}
                    style={{ display:"inline-flex", alignItems:"center", gap:"0.4rem", background:"transparent", color:T.warn, border:`1px solid ${T.warn}`, borderRadius:"0.5rem", padding:"0.5rem 0.9rem", minHeight:"2.75rem", fontWeight:"700", fontSize:"0.875rem", cursor:closeBusy?"not-allowed":"pointer" }}>
                    {closeBusy ? "Reabrindo…" : "Reabrir mês"}
                  </button>
                ) : (
                  <button onClick={() => setCloseDialog('close')} disabled={closeBusy || allMonthEntries.length === 0}
                    style={{ display:"inline-flex", alignItems:"center", gap:"0.4rem", background:"transparent", color:closeBusy||allMonthEntries.length===0?T.textMuted:T.textSecondary, border:`1px solid ${T.cancelBorder}`, borderRadius:"0.5rem", padding:"0.5rem 0.9rem", minHeight:"2.75rem", fontWeight:"700", fontSize:"0.875rem", cursor:closeBusy||allMonthEntries.length===0?"not-allowed":"pointer" }}>
                    <Icon name="check" size={14} /> {closeBusy ? "Fechando…" : "Fechar mês"}
                  </button>
                )
              )}
              <Button T={T} size="sm" variant="secondary" onClick={exportCSV} disabled={displayEntries.length === 0}>
                <Icon name="download" size={14} /> Exportar CSV
              </Button>
            </div>
          </div>
          {isClosed && (
            <p className="flex items-center gap-1.5 text-xs font-semibold mb-3" style={{ color:T.success }}>
              <Icon name="check" size={13} />
              Fechado em {fmtClosedAt(closedSnap.closedAt)} por {closedSnap.closedBy} — valores congelados para a folha.
            </p>
          )}
          {closeError && (
            <p role="alert" className="flex items-center gap-1.5 text-xs font-semibold mb-3" style={{ color:T.danger }}>
              <Icon name="alert" size={13} /> {closeError}
            </p>
          )}
          <div className="grid gap-2" style={{ gridTemplateColumns:"repeat(auto-fit, minmax(150px, 1fr))" }}>
            {[
              { label:"Sobreaviso",  h:displayTotals.sobreaviso, v:displayTotals.valorSobreaviso,      neg:false, formula:"⅓ do valor-hora",           tone:TYPE_TONE.Sobreaviso },
              { label:"Hora Extra",  h:displayTotals.extra,      v:displayTotals.valorExtra,           neg:false, formula:"valor-hora × 1,5",          tone:TYPE_TONE["Hora Extra"] },
              { label:"Compensação", h:displayTotals.comp,       v:displayTotals.valorComp ?? null,     neg:true,  formula:"⅓ do valor-hora · abate da NF", tone:TYPE_TONE.Compensação },
            ].map(b => {
              const c = toneColors(T, b.tone);
              return (
                <div key={b.label} style={{ background:c.bg, border:`1px solid ${c.border}`, borderRadius:T.rControl, padding:"0.6rem 0.7rem" }}>
                  <div style={{ fontSize:"0.7rem", fontWeight:700, letterSpacing:"0.03em", textTransform:"uppercase", color:c.fg }}>{b.label}</div>
                  <div className="tnum" style={{ fontSize:"1.35rem", fontWeight:700, lineHeight:1.2, color:T.textPrimary, fontVariantNumeric:"tabular-nums" }}>{fmtHM(b.h)}</div>
                  {b.v !== null && displayValorHora > 0 && (
                    <div className="tnum" style={{ fontSize:"0.85rem", fontWeight:600, color:c.fg }}>
                      {b.neg && b.v > 0 ? "− " : ""}{brl(b.v)}
                    </div>
                  )}
                  {/* textSecondary, não textMuted: sobre o fundo tingido do
                      cartão o muted caía para ~4,1:1, abaixo de AA em 10,6px. */}
                  <div style={{ fontSize:"0.68rem", marginTop:"0.15rem", color:T.textSecondary }}>{b.formula}</div>
                </div>
              );
            })}
          </div>
          {!isClosed && totals.overlapMin > 0 && (
            <p className="flex items-start gap-1.5 text-xs mt-3" style={{ color:T.warn }}>
              <Icon name="alert" size={13} style={{ flexShrink:0, marginTop:'0.1rem' }} />
              <span>Há lançamentos com horários sobrepostos — <b>{fmtHM(totals.overlapMin / 60)}</b> em comum foi contado uma vez só. O total usa a união dos períodos, não a soma das linhas.</span>
            </p>
          )}
          <div className="mt-3 pt-3 flex items-center justify-between" style={{ borderTop:`1px solid ${T.cardBorder}` }}>
            <span className="text-sm" style={{ color:T.labelColor }}>Total de horas: <b style={{ color:T.textPrimary }}>{fmtHM(displayTotals.totalHoras)}</b></span>
            <div className="text-right">
              <div className="text-xs" style={{ color:T.labelColor }}>Valor total a receber</div>
              <div className="text-2xl font-bold" style={{ color:p.ink }}>
                {displayValorHora > 0 ? brl(displayTotals.valorTotal) : "—"}
              </div>
            </div>
          </div>

          {/* VALOR DA NF — remuneração + SA + HE − Compensação; oculto por padrão, igual à remuneração */}
          <div className="mt-3 pt-3 flex items-center justify-between gap-3 flex-wrap" style={{ borderTop:`1px solid ${T.cardBorder}` }}>
            <div>
              <div className="text-xs" style={{ color:T.labelColor }}>Valor da NF <span style={{ color:T.textMuted }}>(remuneração + SA + HE − Compensação)</span></div>
              <div className="text-2xl font-bold" style={{ color:p.ink }}>
                {nfVisible ? (displayValorHora > 0 || displayRemuneracao > 0 ? brl(valorNF) : "—") : "R$ ••••••"}
              </div>
            </div>
            <button type="button" onClick={() => setNfVisible(v => !v)} aria-label={nfVisible ? "Ocultar valor da NF" : "Mostrar valor da NF"}
              style={{ background:"transparent", color:T.textMuted, border:`1px solid ${T.cardBorder}`, borderRadius:"0.5rem", width:"2.75rem", height:"2.75rem", flexShrink:0, display:"inline-flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}>
              <Icon name={nfVisible ? "eyeOff" : "eye"} size={16} />
            </button>
          </div>
        </section>

        {/* TABELA */}
        <section style={{ border:`1px solid ${T.border}`, borderRadius:T.rPanel, overflow:"hidden" }}>
          <div className="px-4 py-3 flex items-center justify-between flex-wrap gap-2" style={{ background:T.cardBg, borderBottom:`1px solid ${T.cardBorder}` }}>
            <h2 className="text-sm font-semibold inline-flex items-center gap-2" style={{ color:T.textSecondary }}>
              Lançamentos ({displayEntries.length})
              {isClosed && (
                <Badge T={T} tone="success">congelados</Badge>
              )}
            </h2>
            {/* Legenda da tabela — mesmo tom que a etiqueta de cada linha usa. */}
            <div className="flex items-center gap-3" style={{ fontSize:"0.66rem", fontWeight:600, color:T.textMuted }}>
              {[
                { tone: TYPE_TONE.Sobreaviso,     label: "SA · escala automática" },
                { tone: TYPE_TONE["Hora Extra"],  label: "HE · manual" },
              ].map(({ tone, label }) => {
                const c = toneColors(T, tone);
                return (
                  <span key={label} className="flex items-center gap-1">
                    <span style={{ width:8, height:8, borderRadius:"2px", flexShrink:0, background:c.bg, border:`1px solid ${c.fg}` }} />
                    {label}
                  </span>
                );
              })}
            </div>
          </div>

          {displayEntries.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm" style={{ color:T.textMuted, background:T.cardBg }}>
              {dataLoading ? "Carregando…"
                : monthBeforeTeamStart ? `${team.nome} só passou a existir a partir de ${team.startsOn.slice(8,10)}/${team.startsOn.slice(5,7)}/${team.startsOn.slice(0,4)} — não há sobreaviso a mostrar antes disso.`
                : "Nenhum lançamento neste mês. Os sobreavisos da escala aparecem aqui automaticamente."}
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
                    <th style={thStyle} scope="col">Status</th>
                    <th style={{ ...thStyle, width:"100%" }} scope="col">Projeto / Atividade</th>
                    <th style={thStyle} scope="col"><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {displayEntries.map((e) => {
                    const h = durationHours(e.inicio, e.fim);
                    const tagC = toneColors(T, TYPE_TONE[e.tipo]);
                    const rowBg = e._fromSchedule
                      ? T.rowSchedBg
                      : editId === e.id ? T.rowEditBg : "transparent";
                    const statusMeta = e.tipo === "Hora Extra" ? STATUS_META[e.status || "aprovado"] : null;

                    return (
                      <tr key={e.id} style={{ borderTop:`1px solid ${T.divider}`, background:rowBg }}>
                        <td className="tnum whitespace-nowrap" style={{ fontFamily:T.fontMono, fontWeight:700, color:T.textSecondary, padding:"0.45rem 0.5rem" }}>
                          {e.data.slice(8,10)}/{e.data.slice(5,7)}
                        </td>
                        <td style={{ padding:"0.45rem 0.5rem" }}>
                          <span className="whitespace-nowrap" style={{ background:tagC.bg, color:tagC.fg, borderRadius:T.rChip, padding:"0.1rem 0.35rem", fontSize:"0.68rem", fontWeight:700 }}>
                            {e._fromSchedule ? "SA" : e.tipo === "Hora Extra" ? "HE" : "Comp"}
                          </span>
                        </td>
                        <td className="tnum whitespace-nowrap" style={{ fontFamily:T.fontMono, fontSize:"0.76rem", color:T.textMuted, padding:"0.45rem 0.5rem" }}>{e.inicio}–{e.fim}</td>
                        <td className="tnum whitespace-nowrap" style={{ fontFamily:T.fontMono, fontSize:"0.76rem", fontWeight:700, color:T.textSecondary, padding:"0.45rem 0.5rem" }}>{fmtHM(h)}</td>
                        <td style={{ padding:"0.5rem" }}>
                          {statusMeta && (
                            <>
                              <span className="rounded-md px-2 py-0.5 text-xs font-bold whitespace-nowrap" style={{ background:statusMeta.bg, color:statusMeta.color }}>
                                {statusMeta.label}
                              </span>
                              {e.motivo && (
                                <div className="text-xs mt-0.5" style={{ color:T.textMuted, maxWidth:"10rem" }}>{e.motivo}</div>
                              )}
                            </>
                          )}
                        </td>
                        <td className="truncate" style={{ color:T.textSecondary, padding:"0.5rem", maxWidth:"1px", width:"100%" }}>
                          {e.projeto && <b style={{ color:T.textPrimary }}>{e.projeto}: </b>}{e.atividade}
                        </td>
                        <td style={{ padding:"0.15rem 0.35rem", whiteSpace:"nowrap" }}>
                          {!e._fromSchedule && !isClosed && (
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
        </>
        )}
      </div>

      <Snackbar
        open={!!undoEntry}
        message={undoEntry ? `Lançamento de ${undoEntry.data ? `${undoEntry.data.slice(8,10)}/${undoEntry.data.slice(5,7)}` : ''} excluído` : ''}
        actionLabel="Desfazer"
        onAction={undoRemove}
        T={T}
      />

      <ConfirmDialog
        open={!!closeDialog}
        title={closeDialog === 'close'
          ? `Fechar ${MONTHS[monthIdx]} de ${year} — ${person}?`
          : `Reabrir ${MONTHS[monthIdx]} de ${year} — ${person}?`}
        body={closeDialog === 'close'
          ? `Totais (${brl(totals.valorTotal)}), parâmetros e ${allMonthEntries.length} lançamento${allMonthEntries.length !== 1 ? 's' : ''} ficam congelados para a folha. Novos lançamentos neste mês serão bloqueados. Você poderá reabrir depois, se necessário.`
          : 'Os valores voltam a ser recalculados com a escala e os parâmetros atuais — o snapshot congelado é descartado. Lançamentos neste mês voltam a ser permitidos.'}
        confirmLabel={closeDialog === 'close' ? 'Fechar mês' : 'Reabrir mês'}
        cancelLabel="Cancelar"
        onConfirm={() => { const action = closeDialog; setCloseDialog(null); action === 'close' ? closeMonth() : reopenMonth(); }}
        onCancel={() => setCloseDialog(null)}
        T={T}
      />
    </div>
  );
}
