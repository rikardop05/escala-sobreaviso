// Visão de custo do Relatório Consolidado (docs/specs/relatorio-consolidado-custo.md).
// Camada de dados e agregação — módulo puro (sem React), importável no cliente e no
// runtime Node do Vercel (mesmo padrão de src/lib/chCalc.js). Reusa chCalc/schedule/
// teams; NÃO altera nenhuma fórmula do Controle de Horas.
//
// Exports:
//   currentMonthKey()              → 'YYYY-MM' do mês corrente (competência aberta).
//   monthKeysForRange(end, count)  → range de competências, default últimos 12 meses.
//   loadCustoSources(api, adminOf) → busca as equipes do escopo (adminOf) nos endpoints
//                                    existentes e devolve `sources`.
//   custoConsolidado(params)       → dados agregados: competências → equipes → pessoas.
//   buildCustoCsv(dados, opts)     → string CSV filtrada (padrão do relatório atual).
//
// Regras preservadas (spec §Métricas, §Fechamento, §Pendências):
//   - escopo adminOf: só agrega equipes de chGroupsFor(adminOf); teamFilter é
//     intersectado com o escopo (scheduleEditOf NÃO dá acesso financeiro).
//   - arredondamento por linha: cada componente é arredondado (centavos/minutos)
//     antes da soma agregada — mesmos helpers do RelatorioConsolidado.jsx, manter em
//     sincronia.
//   - HE contabilizável = isEntryCountable (aprovado/legado). Pendente e rejeitada
//     NUNCA entram no realizado; ficam em hePendente*/heRejeitadoHoras.
//   - Compensação é abatimento: custo = remuneração + valorSA + valorHE − valorComp.
//   - Ajustes locais não persistidos nunca entram (a lib nem os recebe).
//   - Snapshot sem componente (remuneração, SA, HE, Compensação) → dado indisponível
//     + risco registrado, nunca zero silencioso. valorComp ausente mas `comp` (horas)
//     + `valorHora` presentes no snapshot → derivado pela fórmula oficial do
//     monthTotals (snapshots antigos não gravavam a chave monetária).
//   - Falha de fonte (ch-close incluído) PROPAGA para o estado "Erro ao carregar" —
//     nunca vira gráfico zerado nem ausência real de atividade (§Estados da spec).
//   - Situação dos lançamentos: Realizado mantém o custo oficial; Pendente e
//     Rejeitado são consultáveis separadamente como pendência/potencial (horas +
//     valor potencial) em `situacoes`, NUNCA somados ao realizado. Cada nível expõe
//     `situacaoAtiva` (label + custo/horas exibidos da situação do filtro) para a UI;
//     o CSV exporta a situação ativa como HE/Custo e deixa os demais componentes em
//     branco quando não se aplicam.

import { TEAMS, MEMBERS, chGroupsFor } from './teams.js';
import { buildSchedule, mergedHours, fmtHM, brl } from './schedule.js';
import { scheduleEntriesFor, monthTotals, isEntryCountable } from './chCalc.js';

const roundCents = (v) => Math.round((v || 0) * 100) / 100;
const roundMinutes = (h) => Math.round((h || 0) * 60) / 60;

const FIELD_ROUNDERS = {
  remuneracao: roundCents,
  valorSA: roundCents,
  valorHE: roundCents,
  valorComp: roundCents,
  custo: roundCents,
  horasSA: roundMinutes,
  horasHE: roundMinutes,
  horasComp: roundMinutes,
  hePendenteHoras: roundMinutes,
  hePendenteValor: roundCents,
  heRejeitadoHoras: roundMinutes,
  heRejeitadoValor: roundCents,
  custoPendente: roundCents,
  custoRejeitado: roundCents,
};

// Bloco uniforme de situação por nível (pessoa/equipe/competência): cada situação
// é auto-consistente (horas + valor + custo do MESMO conjunto). Pendente e
// Rejeitado são potencial — `custo` aí é o valor potencial, nunca somado ao
// realizado. `situacoes.realizado` é o custo oficial.
function buildSituacoes(t) {
  return {
    realizado: { horasHE: t?.horasHE ?? null, valorHE: t?.valorHE ?? null, custo: t?.custo ?? null },
    pendente: { horasHE: t?.hePendenteHoras ?? null, valorHE: t?.hePendenteValor ?? null, custo: t?.custoPendente ?? null },
    rejeitado: { horasHE: t?.heRejeitadoHoras ?? null, valorHE: t?.heRejeitadoValor ?? null, custo: t?.custoRejeitado ?? null },
  };
}

const SITUACAO_LABEL = { realizado: 'Realizado', pendente: 'Pendente', rejeitado: 'Rejeitado' };

// Campos DERIVADOS da situação ativa, por nível — a UI usa estes em vez de
// interpretar o filtro: label da situação + custo/horas HE exibidos. Para
// pendente/rejeitado, `custo` é o valor POTENCIAL da situação; os demais
// componentes (remuneração/SA/Compensação) não se aplicam e ficam indisponíveis.
function buildSituacaoAtiva(t, situacao) {
  const bloco = t?.situacoes?.[situacao] || {};
  return {
    chave: situacao,
    label: SITUACAO_LABEL[situacao] || situacao,
    custo: bloco.custo ?? null,
    valorHE: bloco.valorHE ?? null,
    horasHE: bloco.horasHE ?? null,
  };
}

export function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function monthKeysForRange(endMonthKey, count = 12) {
  const [y, m] = String(endMonthKey).split('-').map(Number);
  const keys = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

// Busca, uma vez por pessoa, os dados dos endpoints existentes. Nenhuma equipe fora
// de adminOf é consultada — é isto que garante o escopo (spec §Acesso e escopo).
// Falha de qualquer fonte (ch-close incluído) PROPAGA para o estado "Erro ao
// carregar": sem os snapshots não há como distinguir mês fechado de recalculado, e
// a spec proíbe transformar falha de fonte em ausência real de atividade (§Estados).
export async function loadCustoSources(api, adminOf) {
  const groups = chGroupsFor(adminOf);
  const schedulePairs = await Promise.all(groups.map(async (g) => {
    const [sched, subs] = await Promise.all([
      api(`/api/schedule?team=${g.teamId}`),
      api(`/api/substitutions?team=${g.teamId}`),
    ]);
    return [g.teamId, { overrides: sched?.overrides || {}, subs: subs || [] }];
  }));
  const people = groups.flatMap(g => g.people.map(person => ({ person, teamId: g.teamId })));
  const personPairs = await Promise.all(people.map(async ({ person }) => {
    const [chData, closedData] = await Promise.all([
      api(`/api/ch?person=${encodeURIComponent(person)}`),
      api(`/api/ch-close?person=${encodeURIComponent(person)}`),
    ]);
    return [person, {
      entries: chData?.entries || [],
      params: chData?.params || {},
      closed: closedData || {},
    }];
  }));
  return {
    escopo: groups.map(g => ({ teamId: g.teamId, nome: g.nome })),
    schedule: Object.fromEntries(schedulePairs),
    pessoas: Object.fromEntries(personPairs),
  };
}

function firstMonthKey(team) {
  return team?.startsOn ? String(team.startsOn).slice(0, 7) : null;
}

function personMonthRow({ team, schedule, subs, ch, closedSnap, person, monthKey, openMonthKey, includeRemuneracao, situacao }) {
  const base = {
    person,
    personNome: MEMBERS[person]?.fullName || person,
    hue: MEMBERS[person]?.hue ?? null,
    teamId: team.id,
  };

  const first = firstMonthKey(team);
  if (first && monthKey < first) {
    const vazio = {
      horasHE: null, valorHE: null, custo: null,
    };
    const situacoes = { realizado: vazio, pendente: vazio, rejeitado: vazio };
    return {
      ...base,
      estado: 'sem-dados', origem: null, disponivel: false, ativo: false,
      remuneracao: null, valorSA: null, valorHE: null, valorComp: null, custo: null,
      horasSA: null, horasHE: null, horasComp: null,
      heAprovadoHoras: null, hePendenteHoras: null, hePendenteValor: null,
      heRejeitadoHoras: null, heRejeitadoValor: null, custoPendente: null, custoRejeitado: null,
      situacoes,
      situacaoAtiva: buildSituacaoAtiva({ situacoes }, situacao),
      risco: [],
    };
  }

  const risco = [];
  let estado, origem, remuneracao, horas, valores;
  let pendenteHoras = 0, pendenteValor = 0, rejeitadoHoras = 0, rejeitadoValor = 0;

  if (closedSnap) {
    estado = 'fechado';
    origem = 'snapshot';
    const t = closedSnap.totals || {};
    const snapRem = closedSnap.params?.remuneracao;
    remuneracao = snapRem === undefined || snapRem === null || snapRem === '' ? null : Number(snapRem);
    if (remuneracao === null) risco.push('snapshot sem remuneração');
    const ausentes = [];
    horas = {}; valores = {};
    for (const [h, v] of [['sobreaviso', 'valorSobreaviso'], ['extra', 'valorExtra'], ['comp', 'valorComp']]) {
      if (t[h] === undefined) {
        ausentes.push(`${h}/${v}`);
        horas[h] = null;
        valores[v] = null;
        continue;
      }
      horas[h] = Number(t[h]);
      if (t[v] !== undefined) {
        valores[v] = Number(t[v]);
      } else if (h === 'comp' && t.valorHora !== undefined) {
        // Fechamentos antigos não gravavam valorComp (o schema stripava a chave) —
        // as horas de Compensação e o valorHora são oficiais no snapshot; o valor é
        // a mesma fórmula do monthTotals (valorHora/3 × comp), não invenção.
        valores[v] = (Number(t.valorHora) / 3) * Number(t[h]);
      } else {
        ausentes.push(`${h}/${v}`);
        valores[v] = null;
      }
    }
    if (ausentes.length) risco.push(`snapshot sem componente: ${ausentes.join(', ')}`);
  } else {
    estado = monthKey === openMonthKey ? 'aberto' : 'estimado';
    origem = 'recalculado';
    const rawParams = ch?.params?.[person] || { remuneracao: 0, jornada: 168 };
    remuneracao = Number(rawParams.remuneracao) || 0;
    const valorHora = remuneracao / (Number(rawParams.jornada) || 168);
    const [y, m] = monthKey.split('-').map(Number);
    const entries = (ch?.entries || [])
      .filter(e => e.person === person && String(e.data).slice(0, 7) === monthKey);
    const scheduleEntries = scheduleEntriesFor(schedule, subs, person, m - 1, y);
    const t = monthTotals([...scheduleEntries, ...entries.filter(isEntryCountable)], valorHora);
    horas = { sobreaviso: t.sobreaviso, extra: t.extra, comp: t.comp };
    valores = { valorSobreaviso: t.valorSobreaviso, valorExtra: t.valorExtra, valorComp: t.valorComp };
    const he = entries.filter(e => e.tipo === 'Hora Extra');
    pendenteHoras = mergedHours(he.filter(e => e.status === 'pendente'));
    pendenteValor = valorHora * 1.5 * pendenteHoras;
    rejeitadoHoras = mergedHours(he.filter(e => e.status === 'rejeitado'));
    rejeitadoValor = valorHora * 1.5 * rejeitadoHoras;
  }

  const componenteFalta = risco.some(r => r.startsWith('snapshot sem componente'));
  const remuneracaoFalta = risco.some(r => r === 'snapshot sem remuneração');
  const disponivel = !componenteFalta && !(remuneracaoFalta && includeRemuneracao);

  const linha = {
    remuneracao: includeRemuneracao ? (remuneracao === null ? null : roundCents(remuneracao)) : 0,
    valorSA: valores.valorSobreaviso === null ? null : roundCents(valores.valorSobreaviso),
    valorHE: valores.valorExtra === null ? null : roundCents(valores.valorExtra),
    valorComp: valores.valorComp === null ? null : roundCents(valores.valorComp),
    horasSA: horas.sobreaviso === null ? null : roundMinutes(horas.sobreaviso),
    horasHE: horas.extra === null ? null : roundMinutes(horas.extra),
    horasComp: horas.comp === null ? null : roundMinutes(horas.comp),
    hePendenteHoras: roundMinutes(pendenteHoras),
    hePendenteValor: roundCents(pendenteValor),
    heRejeitadoHoras: roundMinutes(rejeitadoHoras),
    // Potencial de pendência/rejeição — NUNCA entra no realizado (custo acima).
    heRejeitadoValor: roundCents(rejeitadoValor),
    custoPendente: roundCents(pendenteValor),
    custoRejeitado: roundCents(rejeitadoValor),
  };
  linha.custo = disponivel
    ? roundCents((includeRemuneracao ? linha.remuneracao : 0) + linha.valorSA + linha.valorHE - linha.valorComp)
    : null;
  linha.heAprovadoHoras = linha.horasHE;

  const ativo = (linha.horasSA ?? 0) + (linha.horasHE ?? 0) + (linha.horasComp ?? 0) > 0;

  const situacoes = buildSituacoes(linha);
  return {
    ...base, estado, origem, disponivel, ativo, ...linha,
    situacoes,
    situacaoAtiva: buildSituacaoAtiva({ situacoes }, situacao),
    risco,
  };
}

function sumRows(rows) {
  if (!rows.length) {
    const total = {};
    for (const field of Object.keys(FIELD_ROUNDERS)) total[field] = null;
    return total;
  }
  const total = {};
  for (const [field, rounder] of Object.entries(FIELD_ROUNDERS)) {
    if (rows.some(r => r[field] === null || r[field] === undefined)) {
      total[field] = null;
      continue;
    }
    let acc = 0;
    for (const r of rows) acc = rounder(acc + r[field]);
    total[field] = acc;
  }
  return total;
}

function aggregateTeam(team, rows, situacao) {
  const estado = rows.length === 0 || rows.every(p => p.estado === 'sem-dados') ? 'sem-dados'
    : rows.some(p => p.estado === 'aberto') ? 'aberto'
    : rows.some(p => p.estado === 'estimado') ? 'estimado'
    : 'fechado';
  const origem = estado === 'sem-dados' ? null
    : rows.some(p => p.origem === 'recalculado') ? 'recalculado'
    : 'snapshot';
  const disponivel = rows.length > 0 && rows.every(p => p.disponivel);
  const total = sumRows(rows);
  total.situacoes = buildSituacoes(total);
  total.situacaoAtiva = buildSituacaoAtiva(total, situacao);
  return {
    teamId: team.id,
    teamNome: team.nome,
    startsOn: team.startsOn,
    estado,
    origem,
    disponivel,
    total,
    pessoas: rows,
  };
}

// Soma os totais das equipes do mês EXCLUINDO as "sem dados" (equipe ainda não
// existia — ausência esperada, não falha). Uma equipe sem dados não pode anular o
// mês inteiro: só quando a equipe existia mas o dado está indisponível o campo
// correspondente vira null (nunca parcial como completo).
function sumTeamTotals(equipes) {
  const ativas = equipes.filter(e => e.estado !== 'sem-dados');
  if (!ativas.length) {
    const total = {};
    for (const field of Object.keys(FIELD_ROUNDERS)) total[field] = null;
    return total;
  }
  const total = {};
  for (const [field, rounder] of Object.entries(FIELD_ROUNDERS)) {
    if (ativas.some(e => e.total[field] === null || e.total[field] === undefined)) {
      total[field] = null;
      continue;
    }
    let acc = 0;
    for (const e of ativas) acc = rounder(acc + e.total[field]);
    total[field] = acc;
  }
  return total;
}

function aggregateMonth(monthKey, equipes, situacao) {
  const est = new Set(equipes.map(e => e.estado));
  const estado = est.size === 1 && est.has('sem-dados') ? 'sem-dados'
    : est.has('aberto') ? 'aberto'
    : est.has('estimado') ? 'estimado'
    : 'fechado';
  const total = sumTeamTotals(equipes);
  total.situacoes = buildSituacoes(total);
  total.situacaoAtiva = buildSituacaoAtiva(total, situacao);
  return { monthKey, estado, total, equipes };
}

const sumSkipNull = (list, field, rounder) => {
  let acc = 0;
  for (const item of list) {
    const v = item?.[field];
    if (v !== null && v !== undefined) acc = rounder(acc + v);
  }
  return acc;
};

// Params:
//   sources             → de loadCustoSources()
//   adminOf             → '*' | [teamId...] (do profile). Escopo financeiro.
//   range               → ['YYYY-MM', ...] ordenado. Default: últimos 12 meses até o mês aberto.
//   openMonthKey        → mês em aberto (recalculado). Default: mês corrente.
//   teamFilter          → [teamId...] | null (null = todas as do escopo). Interseção com adminOf.
//   personFilter        → [person...] | null (null = todas do roster).
//   metric              → 'custo' | 'horasSA' | 'horasHE'. Só ecoado; todas as métricas são
//                         sempre calculadas — o componente escolhe o que plotar.
//   situacao            → 'realizado' (default) | 'pendente' | 'rejeitado'. Seleciona
//                         o bloco `situacoes[situacao]` que a UI deve consultar em cada
//                         nível (pessoa/equipe/competência/indicadores). Realizado é o
//                         custo oficial; pendente/rejeitado são potencial (horas + valor),
//                         nunca somados ao realizado.
//   includeRemuneracao  → true (Custo Mensal) | false (Custo Variável). Quando false,
//                         remuneracao é zerada na composição e o custo exclui a remuneração.
export function custoConsolidado({
  sources,
  adminOf,
  range,
  openMonthKey = currentMonthKey(),
  teamFilter = null,
  personFilter = null,
  metric = 'custo',
  situacao = 'realizado',
  includeRemuneracao = true,
}) {
  const escopoIds = chGroupsFor(adminOf).map(g => g.teamId);
  const escopo = escopoIds.map(teamId => ({ teamId, nome: TEAMS[teamId].nome }));
  const teamIds = teamFilter ? teamFilter.filter(id => escopoIds.includes(id)) : escopoIds;
  // Equipes EFETIVAMENTE agregadas (teamFilter já intersectado com adminOf) — o
  // resumo do CSV e os rótulos devem refletir exatamente estas, nunca o escopo.
  const filtroEquipes = teamIds.map(teamId => ({ teamId, nome: TEAMS[teamId].nome }));
  const monthKeys = range && range.length ? range : monthKeysForRange(openMonthKey);

  const schedules = {};
  for (const teamId of teamIds) {
    const team = TEAMS[teamId];
    const overrides = sources?.schedule?.[teamId]?.overrides || {};
    schedules[teamId] = buildSchedule(team, overrides);
  }

  const competencias = monthKeys.map(monthKey => {
    const equipes = teamIds.map(teamId => {
      const team = TEAMS[teamId];
      const subs = sources?.schedule?.[teamId]?.subs || [];
      const roster = personFilter ? team.roster.filter(p => personFilter.includes(p)) : team.roster;
      const pessoas = roster.map(person => personMonthRow({
        team,
        schedule: schedules[teamId],
        subs,
        ch: sources?.pessoas?.[person],
        closedSnap: sources?.pessoas?.[person]?.closed?.[monthKey] || null,
        person,
        monthKey,
        openMonthKey,
        includeRemuneracao,
        situacao,
      }));
      return aggregateTeam(team, pessoas, situacao);
    });
    return aggregateMonth(monthKey, equipes, situacao);
  });

  const rows = competencias.flatMap(c => c.equipes.flatMap(e => e.pessoas));
  const monthTotalsArr = competencias.map(c => c.total);
  const lastMonth = monthTotalsArr[monthTotalsArr.length - 1];

  // Custo do período: soma SÓ as competências com custo real. Competências "sem
  // dados" (equipe ainda não existia) ficam de fora — não viram zero. Quando o
  // período não cobre o range inteiro (sem dados e/ou dado indisponível), o flag
  // custoPeriodoParcial + as contagens explicam o porquê — sem inventar valor.
  const competenciasSemDados = competencias.filter(c => c.equipes.some(e => e.estado === 'sem-dados')).length;
  const competenciasIndisponiveis = competencias.filter(c => c.equipes.some(e => e.estado !== 'sem-dados' && !e.disponivel)).length;
  const disponiveis = competencias.filter(c => c.total?.custo !== null);
  const custoPeriodo = disponiveis.length === 0
    ? null
    : roundCents(disponiveis.reduce((acc, c) => roundCents(acc + c.total.custo), 0));
  const custoPeriodoParcial = custoPeriodo !== null && (
    disponiveis.length < competencias.length
    || disponiveis.some(c => c.equipes.some(e => e.total?.custo === null))
  );

  const rejeitadoHE = {
    horas: sumSkipNull(monthTotalsArr, 'heRejeitadoHoras', roundMinutes),
    valor: sumSkipNull(monthTotalsArr, 'heRejeitadoValor', roundCents),
  };
  const horasExtras = sumSkipNull(monthTotalsArr, 'horasHE', roundMinutes);

  const indicadores = {
    custoPeriodo,
    custoPeriodoParcial,
    competenciasSemDados,
    competenciasIndisponiveis,
    custoMesSelecionado: lastMonth ? lastMonth.custo : null,
    horasSobreaviso: sumSkipNull(monthTotalsArr, 'horasSA', roundMinutes),
    horasExtras,
    pendenciaHE: {
      horas: sumSkipNull(monthTotalsArr, 'hePendenteHoras', roundMinutes),
      valor: sumSkipNull(monthTotalsArr, 'hePendenteValor', roundCents),
    },
    rejeitadoHE,
    // Visão consistente por situação do período inteiro — a UI lê o bloco do
    // filtro ativo e nunca mistura realizado com pendência/potencial.
    situacoes: {
      realizado: { custo: custoPeriodo, horasHE: horasExtras },
      pendente: { custo: sumSkipNull(monthTotalsArr, 'custoPendente', roundCents), horasHE: sumSkipNull(monthTotalsArr, 'hePendenteHoras', roundMinutes) },
      rejeitado: { custo: sumSkipNull(monthTotalsArr, 'custoRejeitado', roundCents), horasHE: rejeitadoHE.horas },
    },
    estimados: rows.filter(r => r.estado === 'estimado').length,
    indisponiveis: rows.filter(r => !r.disponivel).length,
    riscos: [...new Set(rows.flatMap(r => r.risco))].sort(),
  };

  return {
    filtros: { adminOf, range: monthKeys, openMonthKey, teamFilter, teams: filtroEquipes, personFilter, metric, situacao, includeRemuneracao },
    escopo,
    competencias,
    indicadores,
  };
}

function estadoLabel(estado) {
  return ({ fechado: 'fechado', aberto: 'em aberto', estimado: 'estimado', 'sem-dados': 'sem dados' }[estado] ?? String(estado));
}

function origemLabel(origem) {
  return origem === 'snapshot' ? 'snapshot' : origem === 'recalculado' ? 'recalculado' : '';
}

// CSV filtrado — mesmo padrão do relatório atual (separador ';', aspas, BOM, CRLF).
// Respeita os filtros já aplicados em `dados`; identifica estado e origem por linha;
// nunca inclui ajustes locais (a lib não os recebe). Retorna a string; download é da UI.
export function buildCustoCsv(dados, opts = {}) {
  const { metric = dados.filtros.metric, situacao = dados.filtros.situacao, includeRemuneracao = dados.filtros.includeRemuneracao } = opts;
  const sep = ';';
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const brlFmt = (v) => (v === null || v === undefined ? '' : brl(v));
  const hmFmt = (v) => (v === null || v === undefined ? '' : fmtHM(v));

  // A situação ativa decide o que as colunas HE/Custo exibem:
  //   realizado  → horas/valor/custo realizados (oficiais).
  //   pendente   → horas + valor POTENCIAL pendentes; remuneração/SA/Compensação
  //                NÃO se aplicam à situação e saem em branco (indisponíveis).
  //   rejeitado  → idem para HE rejeitada.
  // Nunca apresentar os valores realizados como se fossem o filtro ativo.
  const ativo = (p) => p?.situacaoAtiva || {};
  const mostraComponentes = situacao === 'realizado';
  const header = ['Competência', 'Equipe', 'Pessoa', 'Estado', 'Origem', 'Remuneração',
    'Valor SA', 'Horas SA', 'Valor HE', 'Horas HE', 'Valor Comp', 'Horas Comp', 'Custo',
    'HE Pendente (h)', 'HE Pendente (R$)', 'HE Rejeitada (h)', 'HE Rejeitada (R$)'];
  const lines = [header.map(q).join(sep)];

  for (const c of dados.competencias) {
    for (const e of c.equipes) {
      for (const p of e.pessoas) {
        const a = ativo(p);
        lines.push([
          c.monthKey, e.teamNome, p.personNome,
          estadoLabel(p.estado), origemLabel(p.origem),
          mostraComponentes ? brlFmt(p.remuneracao) : '',
          mostraComponentes ? brlFmt(p.valorSA) : '',
          mostraComponentes ? hmFmt(p.horasSA) : '',
          brlFmt(a.valorHE), hmFmt(a.horasHE),
          mostraComponentes ? brlFmt(p.valorComp) : '',
          mostraComponentes ? hmFmt(p.horasComp) : '',
          brlFmt(a.custo),
          hmFmt(p.hePendenteHoras), brlFmt(p.hePendenteValor),
          hmFmt(p.heRejeitadoHoras), brlFmt(p.heRejeitadoValor),
        ].map(q).join(sep));
      }
    }
  }

  lines.push('');
  const range = dados.filtros.range;
  lines.push(['RESUMO'].map(q).join(sep));
  lines.push(['Período', `${range[0]} a ${range[range.length - 1]}`].map(q).join(sep));
  // Equipes do RESUMO = as filtradas e efetivamente agregadas (dados.filtros.teams),
  // nunca o escopo completo de adminOf — o CSV só pode citar equipes exibidas.
  const equipesResumo = dados.filtros.teams && dados.filtros.teams.length ? dados.filtros.teams : dados.escopo;
  lines.push(['Equipes', equipesResumo.map(t => t.nome).join(', ')].map(q).join(sep));
  lines.push(['Pessoas', dados.filtros.personFilter ? dados.filtros.personFilter.join(', ') : 'todas'].map(q).join(sep));
  lines.push(['Métrica', metric].map(q).join(sep));
  lines.push(['Situação', SITUACAO_LABEL[situacao] || situacao].map(q).join(sep));
  if (situacao !== 'realizado') {
    lines.push(['Contexto', `Somente HE ${SITUACAO_LABEL[situacao]} (horas + valor potencial); remuneração/sobreaviso/compensação não se aplicam à situação e ficam em branco`].map(q).join(sep));
  }
  lines.push(['Remuneração', includeRemuneracao ? 'Incluída' : 'Excluída'].map(q).join(sep));
  lines.push(['Estado', 'fechado/em aberto/estimado/sem dados identificados por linha'].map(q).join(sep));
  if (dados.indicadores.riscos.length) {
    lines.push(['Riscos', dados.indicadores.riscos.join('; ')].map(q).join(sep));
  }

  return '\uFEFF' + lines.join('\r\n');
}