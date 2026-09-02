import { kvGet } from './_redis.js';
import { requireUser } from './_auth.js';
import { MEMBERS, TEAMS } from '../src/lib/teams.js';
import { readTeamOverrides, readTeamSubs } from './_scheduleData.js';
import { custoPessoal, currentMonthKey, monthKeysForRange } from '../src/lib/custoConsolidado.js';

// Meu Resumo Financeiro — visão pessoal (docs/specs/meu-resumo-financeiro.md).
//
// SEGURANÇA: o alvo é SEMPRE o `memberId` do perfil autenticado (role member OU admin
// com memberId). Nenhum parâmetro do cliente substitui esse alvo: um `?person=`/
// `?pessoa=` divergente é REJEITADO com 403. O payload devolvido contém somente os
// lançamentos/parâmetros/snapshots da própria pessoa + a escala da própria equipe
// (contexto informativo da spec) — nenhum dado de terceiros. A agregação roda no
// servidor via custoPessoal (src/lib/custoConsolidado.js), que não aceita escopo
// adminOf; o frontend só recebe o resultado já calculado.
//
// Período: `period` 6|12 (clamp, default 12) terminando em `month` (default mês atual)
// — histórico máximo de 12 meses, nunca mais.
//
// Query opcionais (afetam APENAS os próprios dados): metric, situacao, remuneracao
// (incluir|excluir; default excluir = Custo Variável, remuneração oculta na spec).
//
// NÃO altera o CSV antigo do Controle de Horas nem a visão administrativa.

const PERIODS = new Set([6, 12]);
const SITUACOES = new Set(['realizado', 'pendente', 'rejeitado']);
const METRICAS = new Set(['custo', 'horasSA', 'horasHE']);
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Decisão de autorização + período, pura e testável (seam de regressão). O alvo é
// SEMPRE o `memberId` autenticado: query `person`/`pessoa`/`member` divergente é
// rejeitada com 403. Período clamp em 6|12 meses (histórico máximo da spec).
export function resolvePersonalParams({ memberId, query = {} }) {
  if (!memberId) {
    return { ok: false, status: 403, body: { error: 'Esta visão exige uma identidade de membro' } };
  }
  for (const key of ['person', 'pessoa', 'member']) {
    const v = query[key];
    if (typeof v === 'string' && v !== memberId) {
      return { ok: false, status: 403, body: { error: 'Forbidden' } };
    }
  }
  const period = PERIODS.has(Number(query.period)) ? Number(query.period) : 12;
  const monthKey = typeof query.month === 'string' && MONTH_RE.test(query.month)
    ? query.month
    : currentMonthKey();
  const range = monthKeysForRange(monthKey, period);
  const situacao = SITUACOES.has(query.situacao) ? query.situacao : 'realizado';
  const metric = METRICAS.has(query.metric) ? query.metric : 'custo';
  const includeRemuneracao = query.remuneracao === 'incluir';
  return { ok: true, params: { period, monthKey, range, situacao, metric, includeRemuneracao } };
}

export default async function handler(req, res) {
  let memberId;
  try {
    ({ memberId } = await requireUser(req));
  } catch (e) {
    return res.status(e.status || 401).json({ error: 'Unauthorized' });
  }

  const decisao = resolvePersonalParams({ memberId, query: req.query || {} });
  if (!decisao.ok) return res.status(decisao.status).json(decisao.body);
  const { period, monthKey, range, situacao, metric, includeRemuneracao } = decisao.params;
  const target = memberId;

  const targetTeamId = MEMBERS[target]?.teamId;
  if (!targetTeamId) return res.status(403).json({ error: 'Esta visão exige uma identidade de membro' });

  const [entries, params, closed, overrides, subs] = await Promise.all([
    kvGet(`member:${target}:ch_entries`).then(v => v ?? []),
    kvGet(`member:${target}:ch_params`).then(v => v ?? {}),
    kvGet(`member:${target}:ch_closed`).then(v => v ?? {}),
    readTeamOverrides(targetTeamId),
    readTeamSubs(targetTeamId),
  ]);

  const sources = {
    escopo: [{ teamId: targetTeamId, nome: TEAMS[targetTeamId].nome }],
    schedule: { [targetTeamId]: { overrides, subs } },
    pessoas: { [target]: { entries, params, closed } },
  };

  try {
    const dados = custoPessoal({
      sources,
      teamId: targetTeamId,
      memberId: target,
      range,
      openMonthKey: currentMonthKey(),
      metric,
      situacao,
      includeRemuneracao,
    });
    return res.status(200).json({
      memberId: target,
      team: { teamId: targetTeamId, nome: TEAMS[targetTeamId].nome, startsOn: TEAMS[targetTeamId].startsOn },
      range,
      ...dados,
    });
  } catch (e) {
    console.error('[meu-resumo] error:', e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}