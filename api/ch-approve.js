import { kvGet, kvSet } from './_redis.js';
import { requireUser } from './_auth.js';
import { adminCovers } from './_allowlist.js';
import { validate, ChApprovePostSchema } from './_validate.js';
import { MEMBERS, TEAMS } from '../src/lib/teams.js';

// Aprovação do excedente de Hora Extra (a parte fora do sobreaviso — ver
// src/lib/chCalc.js, splitHoraExtra). Ação exclusiva de quem administra a
// EQUIPE da pessoa-alvo (adminCovers) — igual a fechamento e relatório
// consolidado. Não existe admin geral permanente hoje ('*' é temporário e está
// marcado como tal em api/_allowlist.js); nada aqui depende disso existir.
//
//   GET  — pendências das equipes em adminOf do requisitante (mesmo admin pode
//          aprovar o próprio excedente).
//   POST — { person, entryId, acao: 'aprovar'|'rejeitar', motivo? }
//
// Índice da fila: team:{teamId}:ch_pending → [{ memberId, entryId }]. É
// derivado — a entrada em member:{memberId}:ch_entries é a verdade. O GET
// descarta silenciosamente itens cujo lançamento não existe mais ou já não
// está pendente (decidido ou excluído em outra requisição) e reescreve o
// índice limpo — não há transação, então o índice pode ficar temporariamente
// desatualizado, e este é o mecanismo que corrige isso.

const isPrivileged = (adminOf) => adminOf === '*' || (Array.isArray(adminOf) && adminOf.length > 0);

async function loadAndCleanQueue(teamId) {
  const key = `team:${teamId}:ch_pending`;
  const queue = (await kvGet(key)) ?? [];
  if (!queue.length) return [];

  const memberIds = [...new Set(queue.map(item => item.memberId))];
  const entriesByMember = new Map(
    await Promise.all(memberIds.map(async (memberId) => [memberId, (await kvGet(`member:${memberId}:ch_entries`)) ?? []]))
  );

  const stillValid = [];
  const pendencias = [];
  for (const item of queue) {
    const entry = (entriesByMember.get(item.memberId) || []).find(e => e.id === item.entryId);
    if (!entry || entry.status !== 'pendente') continue; // descarta silenciosamente
    stillValid.push(item);
    pendencias.push({ person: item.memberId, teamId, entryId: item.entryId, data: entry.data, inicio: entry.inicio, fim: entry.fim });
  }
  if (stillValid.length !== queue.length) await kvSet(key, stillValid);
  return pendencias;
}

export default async function handler(req, res) {
  let adminOf, memberId, email;
  try {
    ({ adminOf, memberId, email } = await requireUser(req));
  } catch (e) {
    return res.status(e.status || 401).json({ error: 'Unauthorized' });
  }
  if (!isPrivileged(adminOf)) return res.status(403).json({ error: 'Forbidden' });

  try {
    if (req.method === 'GET') {
      const teamIds = adminOf === '*' ? Object.keys(TEAMS) : adminOf.filter(id => TEAMS[id]);
      const perTeam = await Promise.all(teamIds.map(loadAndCleanQueue));
      const pendencias = perTeam.flat().sort((a, b) => a.data.localeCompare(b.data) || a.inicio.localeCompare(b.inicio));
      return res.status(200).json(pendencias);
    }

    if (req.method === 'POST') {
      const { ok, data: body } = validate(ChApprovePostSchema, req.body);
      if (!ok) return res.status(400).json({ error: 'Bad request' });
      const { person, entryId, acao, motivo } = body;

      const teamId = MEMBERS[person]?.teamId;
      if (!teamId || !adminCovers(adminOf, teamId)) return res.status(403).json({ error: 'Forbidden' });

      const entriesKey = `member:${person}:ch_entries`;
      const entries = (await kvGet(entriesKey)) ?? [];
      const idx = entries.findIndex(e => e.id === entryId);
      if (idx === -1) return res.status(404).json({ error: 'Not found' });
      if (entries[idx].status !== 'pendente') return res.status(409).json({ error: 'Not pending' });

      const updated = {
        ...entries[idx],
        status: acao === 'aprovar' ? 'aprovado' : 'rejeitado',
        decididoPor: email,
        decididoEm: new Date().toISOString(),
      };
      if (motivo) updated.motivo = motivo.trim();
      entries[idx] = updated;

      // Entrada primeiro, índice depois — mesma ordem de api/ch.js (sem
      // transação, a ordem é o que garante que o índice nunca aponte para uma
      // decisão que na verdade não foi gravada).
      await kvSet(entriesKey, entries);
      const queueKey = `team:${teamId}:ch_pending`;
      const queue = (await kvGet(queueKey)) ?? [];
      await kvSet(queueKey, queue.filter(item => !(item.memberId === person && item.entryId === entryId)));

      return res.status(200).json({ ok: true, entry: updated });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[ch-approve] error:', e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
