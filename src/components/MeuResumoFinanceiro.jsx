import { useState, useEffect, useMemo, useRef } from 'react';
import { useApi } from '../lib/api';
import { currentMonthKey, monthKeysForRange } from '../lib/custoConsolidado';
import { TEAMS, MEMBERS } from '../lib/teams';
import { MONTHS_SHORT, fmtHM, brl, buildSchedule, durationHours } from '../lib/schedule';
import { scheduleEntriesFor } from '../lib/chCalc';
import { getTheme, memberTone, componentTone } from '../lib/theme';
import {
  Icon, Button, Badge, Panel, SectionLabel, Segmented, SegmentedItem, friendlyError,
} from './ui';
import {
  CustoChart, IndicatorTile, DetailTable, ESTADO_META, COMPONENT_LABELS, MONTH_SHORT,
} from './RelatorioCusto';

// Meu Resumo Financeiro (docs/specs/meu-resumo-financeiro.md).
// Versão pessoal e simplificada da visão de custo: só o memberId autenticado,
// uma equipe (contexto), sem ações administrativas, sem filtro de colegas/equipes.
//
// Contrato de dados (src/lib/custoConsolidado.js — custoPessoal / api/meu-resumo.js):
//   { filtros:{adminOf:null,range,teamFilter,teams,personFilter,metric,situacao,includeRemuneracao},
//     escopo:[{teamId,nome}],
//     competencias:[{monthKey,estado,total:{...componentes, situacoes, situacaoAtiva},
//                    equipes:[{teamId,teamNome,estado,origem,disponivel,total,
//                              pessoas:[{person,personNome,hue,teamId,estado,origem,disponivel,ativo,
//                                        ...componentes, situacoes, situacaoAtiva, risco, lançamentos?}]}]}],
//     indicadores:{ custoPeriodo, custoPeriodoParcial, ..., situacoes, ...riscos } }
//
// A camada financeira NÃO é recalculada aqui. A UI consome `dados` (o shape acima).
// A remuneração chega REAL no payload (o membro é o dono); "oculta por padrão" é
// exibição: o front mascara até a ação explícita de revelar e alterna Custo
// Variável ↔ Custo Mensal SEM refetch — usando a relação Variável = Mensal −
// remuneração, já que o payload traz os dois granulares.

const roundCents = (v) => Math.round((v || 0) * 100) / 100;

// CSV pessoal — própria e simplificada, NUNCA o buildCustoCsv/administrativo.
// Só a pessoa autenticada; respeita a competência selecionada, a situação ativa e
// a visibilidade da remuneração. Em Pendente/Rejeitado exporta SOMENTE horas +
// valor potencial da situação (nunca os realizados mascarados).
export function buildMeuResumoCsv(dados, opts = {}) {
  const {
    situacao = dados?.filtros?.situacao || 'realizado',
    includeRemuneracao = false,
    selectedMonth = null,
  } = opts;
  const sep = ';';
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const brlFmt = (v) => (v === null || v === undefined ? '' : brl(v));
  const hmFmt = (v) => (v === null || v === undefined ? '' : fmtHM(v));
  const isRealizado = situacao === 'realizado';
  const sitHECol = situacao === 'pendente' ? 'HE Pendente' : situacao === 'rejeitado' ? 'HE Rejeitada' : 'HE';
  const comp = (dados?.competencias || []).find((c) => c.monthKey === selectedMonth)
    || (dados?.competencias || [])[(dados?.competencias || []).length - 1];

  const header = ['Competência', 'Situação HE', 'Estado', 'Origem'];
  if (isRealizado) {
    if (includeRemuneracao) header.push('Remuneração');
    header.push('Valor SA', 'Horas SA', 'Valor HE', 'Horas HE', 'Valor Comp', 'Horas Comp', 'Custo');
  } else {
    // Pendente/Rejeitado: somente horas + valor potencial correspondentes.
    header.push(`${sitHECol} (h)`, `${sitHECol} (R$)`);
  }
  const lines = [header.map(q).join(sep)];

  if (comp) {
    for (const e of comp.equipes) {
      for (const p of e.pessoas) {
        const bloco = (p?.situacoes && p.situacoes[situacao]) || {};
        const linha = [
          comp.monthKey,
          ({ realizado: 'Realizado', pendente: 'Pendente', rejeitado: 'Rejeitado' }[situacao] ?? situacao),
          ({ fechado: 'fechado', aberto: 'em aberto', estimado: 'estimado', 'sem-dados': 'sem dados' }[p.estado] ?? p.estado),
          p.origem === 'snapshot' ? 'snapshot' : p.origem === 'recalculado' ? 'recalculado' : '',
        ];
        if (isRealizado) {
          if (includeRemuneracao) linha.push(brlFmt(p.remuneracao));
          linha.push(
            brlFmt(p.valorSA), hmFmt(p.horasSA),
            brlFmt(p.valorHE), hmFmt(p.horasHE),
            brlFmt(p.valorComp), hmFmt(p.horasComp),
            brlFmt(p.custo),
          );
        } else {
          linha.push(hmFmt(bloco.horasHE), brlFmt(bloco.valorHE));
        }
        lines.push(linha.map(q).join(sep));
      }
    }
  }

  lines.push('');
  const member = dados?.filtros?.personFilter?.[0];
  lines.push(['RESUMO'].map(q).join(sep));
  lines.push(['Competência', (comp && comp.monthKey) || selectedMonth || ''].map(q).join(sep));
  lines.push(['Pessoa', member ? (MEMBERS[member]?.fullName || member) : ''].map(q).join(sep));
  lines.push(['Métrica', dados?.filtros?.metric || 'custo'].map(q).join(sep));
  lines.push(['Situação', ({ realizado: 'Realizado', pendente: 'Pendente', rejeitado: 'Rejeitado' }[situacao] ?? situacao)].map(q).join(sep));
  lines.push(['Remuneração', includeRemuneracao ? 'Incluída' : 'Oculta (Custo Variável)'].map(q).join(sep));
  lines.push(['Estado', 'fechado/em aberto/estimado/sem dados identificados por linha'].map(q).join(sep));
  if (dados?.indicadores?.riscos?.length) {
    lines.push(['Riscos', dados.indicadores.riscos.join('; ')].map(q).join(sep));
  }
  return '\uFEFF' + lines.join('\r\n');
}

const SIT_META = {
  realizado: { short: 'Realizado', tone: 'accent' },
  pendente: { short: 'Pendente', tone: 'warn' },
  rejeitado: { short: 'Rejeitado', tone: 'danger' },
};

export default function MeuResumoFinanceiro({ dark, profile, dados: dadosProp, api: apiProp }) {
  const api = useApi();
  const T = getTheme(dark);
  const memberId = profile?.memberId;
  const teamId = memberId ? MEMBERS[memberId]?.teamId : null;

  // App.jsx monta esta tela direto, sem o wrapper de página que ControleDeHoras/
  // EstruturaEscala já têm internamente — por isso o conteúdo colava no nav (sem
  // padding) e o fundo padrão do body (branco) aparecia como uma faixa sempre que
  // o conteúdo era mais baixo que a viewport. Mesmo padrão de página das outras
  // telas autenticadas, aplicado nos 4 pontos de retorno (loading/erro/vazio/normal).
  const pageWrap = (children) => (
    <div style={{ minHeight: '100vh', background: T.pageBg, fontFamily: T.fontSans, color: T.textPrimary }}>
      <div className="mx-auto px-3 sm:px-4 py-4" style={{ maxWidth: '1440px' }}>
        {children}
      </div>
    </div>
  );

  const [dados, setDados] = useState(null);
  const [entradas, setEntradas] = useState(null); // lançamentos da pessoa (produção via /api/ch)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [rangeMonths, setRangeMonths] = useState(12);
  const [situacao, setSituacao] = useState('realizado');
  const [remuneracaoRevelada, setRemuneracaoRevelada] = useState(false); // mascarar por padrão
  const [verMensal, setVerMensal] = useState(false);                     // Variável por padrão
  const [selectedMonthKey, setSelectedMonthKey] = useState(null);
  const prevSelected = useRef(null);

  useEffect(() => {
    let cancelled = false;
    if (dadosProp) {
      setDados(dadosProp);
      setError(null);
      setLoading(false);
      return undefined;
    }
    async function load() {
      if (!memberId || !teamId) { setLoading(false); setDados(null); return; }
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          period: String(rangeMonths),
          month: currentMonthKey(),
          situacao,
          metric: 'custo',
          remuneracao: 'incluir', // remuneração real no payload; UI mascara
        });
        const d = await api(`/api/meu-resumo?${params.toString()}`);
        if (!cancelled) setDados(d);
      } catch (e) {
        if (!cancelled) setError(friendlyError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, memberId, teamId, rangeMonths, situacao, dadosProp]);

  // Lançamentos da pessoa (produção): /api/ch devolve os do membro autenticado
  // (backend ignora person divergente); escala/substituições da própria equipe.
  // Na demo os lançamentos já vêm injetados em `dados`, então não refetch.
  useEffect(() => {
    let cancelled = false;
    if (dadosProp || !memberId || !teamId) return undefined;
    async function load() {
      try {
        const [chData, schedData, subsData] = await Promise.all([
          api('/api/ch'),
          api(`/api/schedule?team=${teamId}`),
          api(`/api/substitutions?team=${teamId}`),
        ]);
        if (cancelled) return;
        setEntradas({
          schedule: buildSchedule(TEAMS[teamId], schedData?.overrides || {}),
          subs: subsData || [],
          entries: chData?.entries || [],
        });
      } catch { /* lançamentos são complementares; falha não bloqueia o resumo */ }
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, memberId, teamId, dadosProp]);

  // Lançamentos por competência (somente leitura): SA da escala + manuais da pessoa.
  const lançamentosByMonth = useMemo(() => {
    const map = {};
    if (entradas) {
      const { schedule, subs, entries } = entradas;
      for (const c of (dados?.competencias || [])) {
        const [y, m] = c.monthKey.split('-').map(Number);
        const sa = scheduleEntriesFor(schedule, subs, memberId, m - 1, y)
          .map((e) => ({ data: e.data, tipo: 'Sobreaviso', inicio: e.inicio, fim: e.fim, duracaoHoras: durationHours(e.inicio, e.fim), status: null, origem: 'Escala' }));
        const man = entries
          .filter((e) => e.person === memberId && String(e.data).slice(0, 7) === c.monthKey)
          .map((e) => ({ data: e.data, tipo: e.tipo, inicio: e.inicio, fim: e.fim, duracaoHoras: durationHours(e.inicio, e.fim), status: e.status || 'aprovado', origem: 'Manual' }));
        map[c.monthKey] = [...sa, ...man].sort((a, b) => a.data.localeCompare(b.data) || a.inicio.localeCompare(b.inicio));
      }
      return map;
    }
    // demo: lançamentos injetados por pessoa/competência
    for (const c of (dados?.competencias || [])) {
      for (const e of c.equipes) {
        for (const p of e.pessoas) {
          if (p.lançamentos) map[c.monthKey] = p.lançamentos;
        }
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entradas, dados, memberId]);

  // O histórico exibido vem SEMPRE do seletor 6/12 meses (nunca fica preso ao
  // `dados.filtros.range` do payload — na demo o payload tem 12 fixos). Recorta as
  // competências visíveis ao final do range terminado no mês corrente.
  const range = useMemo(() => monthKeysForRange(currentMonthKey(), rangeMonths), [rangeMonths]);
  const competencias = useMemo(() => {
    if (!dados) return [];
    return (dados.competencias || []).filter((c) => range.includes(c.monthKey));
  }, [dados, range]);
  const defaultMonth = range[range.length - 1];
  const selectedMonth = selectedMonthKey && range.includes(selectedMonthKey) ? selectedMonthKey : defaultMonth;

  const selectedComp = useMemo(() => competencias.find(c => c.monthKey === selectedMonth) || null, [competencias, selectedMonth]);

  // Trocar de competência volta a ocultar a remuneração (spec §Privacidade financeira).
  useEffect(() => {
    if (prevSelected.current !== null && prevSelected.current !== selectedMonth) {
      setRemuneracaoRevelada(false);
      setVerMensal(false);
    }
    prevSelected.current = selectedMonth;
  }, [selectedMonth]);

  const incluiRem = remuneracaoRevelada && verMensal;
  const mostraRemuneracao = remuneracaoRevelada;

  // Custo exibido conforme a visão (Variável ↔ Mensal), sem refetch. Para
  // pendente/rejeitado o "custo" é potencial (não depende de remuneração).
  const custoVisao = (bloco, remun, ehRealizado) => {
    if (!bloco || bloco.custo == null) return null;
    if (incluiRem) return bloco.custo;
    if (ehRealizado) return roundCents((bloco.custo || 0) - (remun || 0));
    return bloco.custo;
  };

  const dadosChart = useMemo(() => {
    if (!dados) return [];
    return competencias.map(c => ({
      monthKey: c.monthKey,
      estado: c.estado,
      teams: c.equipes.map(e => {
        const total = e.total;
        const bloco = (total.situacoes && total.situacoes[situacao]) || {};
        const ehRealizado = situacao === 'realizado';
        const value = custoVisao(bloco, total.remuneracao, ehRealizado);
        const stacked = situacao === 'realizado' ? [
          ...(incluiRem ? [{ kind: 'remuneracao', value: total.remuneracao }] : []),
          { kind: 'sobreaviso', value: total.valorSA },
          { kind: 'horaExtra', value: total.valorHE },
          { kind: 'compensacao', value: total.valorComp },
        ] : null;
        return { teamId: e.teamId, teamNome: e.teamNome, value, stacked, estado: e.estado };
      }),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competencias, situacao, incluiRem]);

  // Detalhamento: o shape traz `custo` = Custo Mensal (payload inclui remuneração).
  // Para a visão Variável ajustamos só o campo `custo` (realizado) — os lançamentos
  // e a situação (valor/horas potenciais) permanecem intactos.
  const detailComp = useMemo(() => {
    if (!selectedComp) return null;
    if (incluiRem) return selectedComp;
    const mapNivel = (nivel, remun) => ({
      ...nivel,
      custo: nivel.custo == null ? null : roundCents(nivel.custo - (remun || 0)),
    });
    const mapPessoa = (p) => ({ ...p, custo: p.custo == null ? null : roundCents(p.custo - (p.remuneracao || 0)) });
    const equipes = selectedComp.equipes.map(e => ({
      ...e,
      total: mapNivel(e.total, e.total.remuneracao),
      pessoas: e.pessoas.map(mapPessoa),
    }));
    return { ...selectedComp, total: mapNivel(selectedComp.total, selectedComp.total.remuneracao), equipes };
  }, [selectedComp, incluiRem]);

  const indicadores = dados?.indicadores || null;
  const selTotal = selectedComp?.total || null;

  const blocoSel = (selTotal?.situacoes && selTotal.situacoes[situacao]) || {};
  const custoMes = custoVisao(blocoSel, selTotal?.remuneracao, situacao === 'realizado');
  const horasHE = blocoSel.horasHE ?? null;
  const pendHE = indicadores?.pendenciaHE || { horas: 0, valor: 0 };
  const rejHE = indicadores?.rejeitadoHE || { horas: 0, valor: 0 };
  // Em Pendente/Rejeitado a Compensação NÃO se aplica (é componente do realizado) —
  // mostrar o valor realizado ali mascararia a situação; exibimos "—".
  const compVisao = situacao === 'realizado'
    ? (selTotal?.valorComp == null ? '—' : (selTotal.valorComp > 0 ? `− ${brl(selTotal.valorComp)}` : brl(0)))
    : '—';
  const compSub = situacao === 'realizado' ? 'abate do custo' : 'não aplicável';
  const temRiscos = (indicadores?.riscos?.length || 0) > 0;
  const compIndisponiveis = indicadores?.competenciasIndisponiveis || 0;

  const chartMode = situacao === 'realizado' ? 'stacked' : 'grouped';
  const legenda = situacao === 'realizado'
    ? Object.keys(COMPONENT_LABELS).filter(k => incluiRem || k !== 'remuneracao')
    : [];

  const onSelectMonth = (monthKey) => setSelectedMonthKey(monthKey);

  const exportCSV = () => {
    if (!dados) return;
    const csv = buildMeuResumoCsv(dados, { selectedMonth, situacao, includeRemuneracao: mostraRemuneracao });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meu-resumo_${memberId ? memberId.replace(/\s/g, '-') : 'pessoa'}_${range[0]}-a-${range[range.length - 1]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const printPDF = () => window.print();

  const personNome = competencias?.[0]?.equipes?.[0]?.pessoas?.[0]?.personNome || (memberId ? (MEMBERS[memberId]?.fullName || memberId) : '');
  const teamNome = dados?.filtros?.teams?.[0]?.nome || (teamId ? (TEAMS[teamId]?.nome || teamId) : '');
  const situLabel = SIT_META[situacao]?.short || situacao;

  const emptyStateStyle = {
    background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.rPanel,
    color: T.textMuted, padding: '1.5rem', textAlign: 'center', fontSize: '0.85rem', marginBottom: '1rem',
  };

  if (loading) return pageWrap(<div role="status" style={emptyStateStyle}>Carregando seu resumo financeiro…</div>);
  if (error) return pageWrap(
    <p role="alert" className="flex items-center gap-1.5 mb-3" style={{ color: T.danger, fontSize: '0.82rem', fontWeight: 600 }}>
      <Icon name="alert" size={14} /> {error}
    </p>
  );
  if (!dados || !selectedComp) return pageWrap(<div role="status" style={emptyStateStyle}>Sem dados do resumo para o período selecionado.</div>);

  const mesesLançamentos = lançamentosByMonth[selectedMonth] || [];

  return pageWrap(
    <div className="print-custo">
      {/* Título de tela real (1,15rem/700), no mesmo papel do de Controle de
          Horas/Estrutura — antes esta tela não tinha nenhum, só o parágrafo de
          resumo abaixo, que é pequeno demais pra fazer esse papel visualmente. */}
      <header className="mb-3">
        <h1 style={{ fontSize: '1.15rem', fontWeight: 700, letterSpacing: '-0.01em', color: T.textPrimary, margin: 0 }}>
          Resumo Financeiro
        </h1>
        {/* RESUMO TEXTUAL da seleção, acessível sem depender do gráfico */}
        <p role="status" aria-live="polite" style={{ fontSize: '0.8rem', color: T.textSecondary, margin: '0.25rem 0 0', lineHeight: 1.5 }}>
          {personNome}
          {' · equipe: '}{teamNome}
          {' · '}{incluiRem ? 'Custo Mensal' : 'Custo Variável'}{incluiRem ? ' com remuneração' : ' (remuneração oculta)'}
          {' · situação '}{situLabel}
        </p>
      </header>

      {/* ALERTAS de pendência/rejeição e integridade */}
      {situacao === 'realizado' && (pendHE.horas > 0 || rejHE.horas > 0) && (
        <div role="alert" className="flex items-start gap-2.5 mb-3"
          style={{ background: T.warnQuiet, border: `1px solid ${T.warnBorder}`, borderRadius: T.rPanel, padding: '0.7rem 0.85rem' }}>
          <Icon name="alert" size={15} style={{ color: T.warn, flexShrink: 0, marginTop: '0.15rem' }} />
          <div style={{ fontSize: '0.82rem', lineHeight: 1.5 }}>
            <b style={{ color: T.textPrimary }}>Há Horas Extras fora do realizado</b>
            {pendHE.horas > 0 && <div className="tnum" style={{ fontSize: '0.76rem', marginTop: '0.2rem', color: T.textSecondary }}>Pendente: {fmtHM(pendHE.horas)} · potencial {brl(pendHE.valor)}</div>}
            {rejHE.horas > 0 && <div className="tnum" style={{ fontSize: '0.76rem', marginTop: '0.2rem', color: T.textSecondary }}>Rejeitada: {fmtHM(rejHE.horas)} · potencial {brl(rejHE.valor)}</div>}
            <div style={{ fontSize: '0.76rem', marginTop: '0.2rem', color: T.textSecondary }}>Pendências e rejeições não entram no custo realizado.</div>
          </div>
        </div>
      )}
      {(temRiscos || compIndisponiveis > 0) && (
        <div role="alert" className="flex items-start gap-2.5 mb-3"
          style={{ background: T.dangerQuiet, border: `1px solid ${T.dangerBorder}`, borderRadius: T.rPanel, padding: '0.7rem 0.85rem' }}>
          <Icon name="alert" size={15} style={{ color: T.danger, flexShrink: 0, marginTop: '0.15rem' }} />
          <div style={{ fontSize: '0.82rem', lineHeight: 1.5 }}>
            <b style={{ color: T.textPrimary }}>Dados indisponíveis no snapshot</b>
            {compIndisponiveis > 0 && <div style={{ fontSize: '0.76rem', marginTop: '0.2rem', color: T.textSecondary }}>{compIndisponiveis} competência(s) com componente indisponível — exibida(s) como "—", nunca como zero.</div>}
            {temRiscos && <div style={{ fontSize: '0.76rem', marginTop: '0.2rem', color: T.textSecondary }}>Registros: {indicadores.riscos.join('; ')}.</div>}
            <div style={{ fontSize: '0.76rem', marginTop: '0.2rem', color: T.textSecondary }}>Valores sem dado não são inventados: permanecem "—".</div>
          </div>
        </div>
      )}

      {/* CONTROLES PESSOAIS (sem ações administrativas) */}
      <Panel T={T} className="print-hide" style={{ padding: '0.85rem', marginBottom: '1rem' }}>
        <div className="flex flex-wrap gap-x-5 gap-y-4 items-end">
          <div>
            <div id="mr-situacao" style={{ fontSize: '0.72rem', fontWeight: 600, color: T.labelColor, display: 'block', marginBottom: '0.35rem' }}>Situação</div>
            <Segmented T={T} className="rc-seg" role="group" aria-labelledby="mr-situacao">
              {['realizado', 'pendente', 'rejeitado'].map((s, i) => (
                <SegmentedItem key={s} T={T} active={situacao === s} first={i === 0} onClick={() => setSituacao(s)}>
                  {SIT_META[s].short}
                </SegmentedItem>
              ))}
            </Segmented>
          </div>
          <div>
            <div id="mr-visao" style={{ fontSize: '0.72rem', fontWeight: 600, color: T.labelColor, display: 'block', marginBottom: '0.35rem' }}>Visão do custo</div>
            <Segmented T={T} className="rc-seg" role="group" aria-labelledby="mr-visao">
              <SegmentedItem T={T} active={!verMensal} first onClick={() => { if (remuneracaoRevelada) setVerMensal(false); }}>Custo Variável</SegmentedItem>
              <SegmentedItem T={T} active={verMensal && remuneracaoRevelada} disabled={!remuneracaoRevelada}
                title={remuneracaoRevelada ? undefined : 'Revele a remuneração para ver o Custo Mensal (Custo Variável + remuneração)'}
                onClick={() => { if (remuneracaoRevelada) setVerMensal(true); }}>Custo Mensal</SegmentedItem>
            </Segmented>
          </div>
          <div>
            <label style={{ fontSize: '0.72rem', fontWeight: 600, color: T.labelColor, display: 'block', marginBottom: '0.35rem' }}>Intervalo</label>
            <div className="inline-flex items-center gap-2">
              <select value={rangeMonths} onChange={e => setRangeMonths(Number(e.target.value))}
                style={{ background: T.inputBg, color: T.textPrimary, border: `1px solid ${T.inputBorder}`, borderRadius: T.rControl, padding: '0.45rem 0.55rem', minHeight: '2.75rem', fontSize: '0.82rem', colorScheme: T.dark ? 'dark' : 'light' }}>
                <option value={6}>6 meses</option>
                <option value={12}>12 meses</option>
              </select>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            {!remuneracaoRevelada && (
              <Button T={T} size="sm" variant="secondary" onClick={() => setRemuneracaoRevelada(true)}>
                <Icon name="eye" size={14} /> Revelar remuneração
              </Button>
            )}
            {remuneracaoRevelada && (
              <Button T={T} size="sm" variant="secondary" onClick={() => setRemuneracaoRevelada(false)}>
                <Icon name="eyeOff" size={14} /> Ocultar remuneração
              </Button>
            )}
            <Button T={T} size="sm" variant="secondary" onClick={exportCSV} style={{ minHeight: '2.75rem' }}>
              <Icon name="download" size={14} /> Exportar CSV
            </Button>
            <Button T={T} size="sm" variant="secondary" onClick={printPDF} style={{ minHeight: '2.75rem' }} aria-label="Imprimir ou salvar o resumo financeiro em PDF">
              Imprimir / PDF
            </Button>
          </div>
        </div>
      </Panel>

      {/* INDICADORES */}
      <div className="grid gap-2 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <IndicatorTile T={T} label={incluiRem ? 'Custo Mensal' : 'Custo Variável'} value={custoMes == null ? '—' : brl(custoMes)} sub={`${MONTH_SHORT(selectedMonth)} · ${ESTADO_META[selectedComp.estado]?.label}`} tone={ESTADO_META[selectedComp.estado]?.tone} />
        <IndicatorTile T={T} label="Horas Sobreaviso" value={selTotal?.horasSA == null ? '—' : fmtHM(selTotal.horasSA)} sub={MONTH_SHORT(selectedMonth)} tone="info" />
        <IndicatorTile T={T} label="Horas Extras" value={horasHE == null ? '—' : fmtHM(horasHE)} sub={situLabel} tone="success" />
        <IndicatorTile T={T} label="Compensação" value={compVisao} sub={compSub} tone="warn" />
        <IndicatorTile T={T} label="Pendências HE" value={fmtHM(pendHE.horas)} sub={pendHE.valor ? `potencial ${brl(pendHE.valor)}` : 'nenhuma'} tone={pendHE.horas > 0 ? 'warn' : 'neutral'} />
        <IndicatorTile T={T} label="Rejeitadas HE" value={fmtHM(rejHE.horas)} sub={rejHE.valor ? `potencial ${brl(rejHE.valor)}` : 'nenhuma'} tone={rejHE.horas > 0 ? 'danger' : 'neutral'} />
      </div>

      {/* GRÁFICO HISTÓRICO (uma pessoa só) */}
      <Panel T={T} style={{ marginBottom: '1rem', overflow: 'hidden' }}>
        <div style={{ padding: '0.8rem 0.9rem', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2 style={{ fontSize: '0.9rem', fontWeight: 700, color: T.textPrimary, margin: 0, letterSpacing: '-0.01em' }}>
            {incluiRem ? 'Custo Mensal' : 'Custo Variável'}
            <span style={{ fontWeight: 400, color: T.textMuted }}>{' · '}{range[0]} a {range[range.length - 1]}</span>
          </h2>
          <div className="flex items-center gap-4 flex-wrap" style={{ fontSize: '0.68rem', color: T.textMuted }}>
            {Object.keys(ESTADO_META).map((k) => (
              <span key={k} className="inline-flex items-center gap-1">
                <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: ESTADO_META[k].tone === 'success' ? T.success : ESTADO_META[k].tone === 'info' ? T.info : ESTADO_META[k].tone === 'warn' ? T.warn : T.textMuted }} />
                {ESTADO_META[k].label}
              </span>
            ))}
          </div>
        </div>
        <div style={{ padding: '0.7rem 0.9rem 0.8rem' }}>
          {dadosChart.every(c => (c.teams || []).every(t => t.value == null)) ? (
            <div style={{ ...emptyStateStyle, marginBottom: 0 }}>Sem atividade para o período — os meses anteriores ao início da sua atuação aparecem como sem dados, não como custo zero.</div>
          ) : (
            <CustoChart
              dadosChart={dadosChart} mode={chartMode} metric="custo" situacao={situacao}
              selectedMonth={selectedMonth} selectedTeamId={teamId} dark={dark} T={T}
              onSelectMonth={onSelectMonth} onSelectTeam={() => {}}
            />
          )}
          {/* LEGENDA dos componentes (quando aplicável) */}
          <div className="flex items-center gap-4 flex-wrap mt-3" style={{ fontSize: '0.72rem', color: T.textSecondary }}>
            {legenda.map((k) => {
              const tone = componentTone(k, dark);
              return (
                <span key={k} className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '2px', background: tone.fill }} />
                  {COMPONENT_LABELS[k]}{k === 'compensacao' && <span style={{ color: T.textMuted }}>(abate)</span>}
                </span>
              );
            })}
          </div>
        </div>
      </Panel>

      {/* DETALHAMENTO */}
      <Panel T={T} style={{ overflow: 'hidden', marginBottom: '1rem' }}>
        <div style={{ padding: '0.8rem 0.9rem', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2 style={{ fontSize: '0.9rem', fontWeight: 700, color: T.textPrimary, margin: 0 }}>
            Detalhamento · {MONTH_SHORT(selectedMonth)}
            <span style={{ fontWeight: 400, color: T.textMuted }}> · {personNome}</span>
          </h2>
          <Badge T={T} tone={ESTADO_META[selectedComp.estado]?.tone} icon={ESTADO_META[selectedComp.estado]?.icon}>{ESTADO_META[selectedComp.estado]?.label}</Badge>
        </div>
        <DetailTable comp={detailComp} metric="custo" includeRemuneracao={mostraRemuneracao} situacao={situacao} dark={dark} T={T} selectedTeamId={teamId} />
      </Panel>

      {/* LANÇAMENTOS INDIVIDUAIS (recolhível, somente leitura) */}
      <Panel T={T} style={{ overflow: 'hidden', marginBottom: '1rem' }}>
        <details style={{ background: T.surface }}>
          <summary style={{ padding: '0.8rem 0.9rem', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 700, color: T.textPrimary, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            Lançamentos do período
            <span style={{ fontSize: '0.72rem', fontWeight: 600, color: T.textMuted }}>{mesesLançamentos.length} lançamento(s)</span>
          </summary>
          {mesesLançamentos.length === 0 ? (
            <div style={{ padding: '0.5rem 0.9rem 1rem', fontSize: '0.8rem', color: T.textSecondary }}>Sem lançamentos listados para a competência selecionada.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="w-full" style={{ borderCollapse: 'collapse', minWidth: '560px', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                    {['Data', 'Tipo', 'Horário', 'Duração', 'Situação'].map(h => (
                      <th key={h} style={{ textAlign: 'left', fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: T.textMuted, padding: '0.5rem 0.6rem', whiteSpace: 'nowrap' }} scope="col">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mesesLançamentos.map((l, i) => {
                    const isHE = l.tipo === 'Hora Extra';
                    const tone = isHE ? (l.status === 'pendente' ? 'warn' : l.status === 'rejeitado' ? 'danger' : 'success') : (l.origem === 'Escala' ? 'info' : 'warn');
                    return (
                      <tr key={`${l.data}-${l.inicio}-${l.tipo}-${i}`} style={{ borderTop: `1px solid ${T.border}` }}>
                        <td className="tnum" style={{ padding: '0.4rem 0.6rem', fontFamily: T.fontMono, fontSize: '0.78rem', color: T.textSecondary, whiteSpace: 'nowrap' }}>{l.data}</td>
                        <td style={{ padding: '0.4rem 0.6rem', whiteSpace: 'nowrap' }}>
                          <Badge T={T} tone={tone}>{isHE ? 'HE' : l.tipo === 'Compensação' ? 'Comp' : 'SA'}</Badge>
                        </td>
                        <td className="tnum" style={{ padding: '0.4rem 0.6rem', fontFamily: T.fontMono, fontSize: '0.78rem', color: T.textMuted, whiteSpace: 'nowrap' }}>{l.inicio}–{l.fim}</td>
                        <td className="tnum" style={{ padding: '0.4rem 0.6rem', fontFamily: T.fontMono, fontSize: '0.78rem', color: T.textSecondary, whiteSpace: 'nowrap' }}>{fmtHM(l.duracaoHoras)}</td>
                        <td style={{ padding: '0.4rem 0.6rem', whiteSpace: 'nowrap' }}>
                          {isHE ? (l.status || 'aprovado') : (l.origem === 'Escala' ? 'escala' : 'manual')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </details>
      </Panel>
    </div>
  );
}
