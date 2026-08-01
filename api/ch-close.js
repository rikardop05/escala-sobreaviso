import { kvGet, kvSet } from './_redis.js';
import { requireUser } from './_auth.js';
import { adminCovers } from './_allowlist.js';
import { validate, checkBodySize, ChClosePostSchema, ChCloseMonthQuery } from './_validate.js';
import { MEMBERS } from '../src/lib/teams.js';

// Fechamento mensal do Controle de Horas.
// Chave: member:{memberId}:ch_closed → { 'YYYY-MM': snapshot }
// snapshot = { closedAt, closedBy, params, totals, entries[] } — imutável até reabertura.
//
// Regras (Fase 1 — docs/specs/multi-equipe.md §3): fechar/reabrir é ação exclusiva de
// quem administra a EQUIPE da pessoa-alvo (adminOf cobre MEMBERS[target].teamId) —
// não mais "qualquer admin".
//   GET    — member lê os próprios fechamentos; admin da equipe lê de qualquer membro dela (?person=)
//   POST   — admin da equipe fecha um mês; recusa se já fechado (reabrir primeiro)
//   DELETE — admin da equipe reabre (?person=&month=)
//
// Os totais são calculados no cliente (a lógica da escala vive em src/lib/schedule.js;
// reimplementá-la aqui só para validar o snapshot duplicaria a lógica financeira em
// dois runtimes). O fechamento é ação exclusiva de admin autenticado e o snapshot é
// validado por schema; o valor congelado é o que o admin viu e aprovou na tela.

const isPrivileged = (adminOf) => adminOf === '*' || (Array.isArray(adminOf) && adminOf.length > 0);

function canAccessMember(requester, target) {
  if (requester.memberId && requester.memberId === target) return true;
  const targetTeam = MEMBERS[target]?.teamId;
  if (!targetTeam) return false;
  return adminCovers(requester.adminOf, targetTeam);
}

export default async function handler(req, res) {
  let memberId, adminOf, email;
  try {
    ({ memberId, adminOf, email } = await requireUser(req));
  } catch (e) {
    return res.status(e.status || 401).json({ error: 'Unauthorized' });
  }

  // Admin fora da escala (memberId null) passa — sempre opera sobre um membro-alvo.
  if (!memberId && !isPrivileged(adminOf)) return res.status(403).json({ error: 'Forbidden' });

  try {
    if (req.method === 'GET') {
      const requestedPerson = typeof req.query.person === 'string' ? req.query.person : null;
      const target = (isPrivileged(adminOf) && requestedPerson) ? requestedPerson : memberId;
      if (!target) return res.status(400).json({ error: 'Bad request' });
      if (isPrivileged(adminOf) && requestedPerson && !canAccessMember({ memberId, adminOf }, target)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const closed = await kvGet(`member:${target}:ch_closed`);
      return res.status(200).json(closed ?? {});
    }

    if (req.method === 'POST') {
      if (!checkBodySize(req.body)) return res.status(400).json({ error: 'Bad request' });
      const { ok, data: body } = validate(ChClosePostSchema, req.body);
      if (!ok) return res.status(400).json({ error: 'Bad request' });

      const target = body.person || memberId;
      if (!target) return res.status(400).json({ error: 'Bad request' });
      // Fechar é ação exclusiva de admin — inclusive sobre o próprio painel, e só de
      // quem administra a equipe do membro-alvo (não "qualquer admin" como antes).
      if (!isPrivileged(adminOf) || !canAccessMember({ memberId, adminOf }, target)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const key = `member:${target}:ch_closed`;
      const closed = (await kvGet(key)) ?? {};
      if (closed[body.month]) return res.status(409).json({ error: 'Month already closed' });

      closed[body.month] = {
        ...body.snapshot,
        closedAt: new Date().toISOString(),
        closedBy: email || memberId,
      };
      await kvSet(key, closed);
      return res.status(200).json(closed);
    }

    if (req.method === 'DELETE') {
      const { person, month } = req.query;
      const { ok } = validate(ChCloseMonthQuery, month);
      if (!ok) return res.status(400).json({ error: 'Bad request' });

      const target = person || memberId;
      if (!target) return res.status(400).json({ error: 'Bad request' });
      if (!isPrivileged(adminOf) || !canAccessMember({ memberId, adminOf }, target)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const key = `member:${target}:ch_closed`;
      const closed = (await kvGet(key)) ?? {};
      if (!closed[month]) return res.status(404).json({ error: 'Not found' });

      delete closed[month];
      await kvSet(key, closed);
      return res.status(200).json(closed);
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[ch-close] error:', e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
