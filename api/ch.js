import { kvGet, kvSet } from './_redis.js';
import { requireUser } from './_auth.js';
import { adminCovers } from './_allowlist.js';
import { validate, checkBodySize, ChPostSchema } from './_validate.js';
import { MEMBERS } from '../src/lib/teams.js';

// Keys use memberId (not userId) so the admin can read/write any member's data.
// ⚠ Migration note: previous keys were 'user:{clerkId}:ch_*'.
//   Existing CH data must be manually re-entered after this change.
//
// Fase 1 da spec de múltiplas equipes (docs/specs/multi-equipe.md §3): acesso ao CH
// de uma pessoa é dela mesma, ou de quem administra a EQUIPE dela (adminOf cobre
// MEMBERS[target].teamId) — não mais "qualquer admin, de qualquer equipe".

const isPrivileged = (adminOf) => adminOf === '*' || (Array.isArray(adminOf) && adminOf.length > 0);

function canAccessMember(requester, target) {
  if (requester.memberId && requester.memberId === target) return true;
  const targetTeam = MEMBERS[target]?.teamId;
  if (!targetTeam) return false; // pessoa desconhecida — nega
  return adminCovers(requester.adminOf, targetTeam);
}

export default async function handler(req, res) {
  let memberId, adminOf;
  try {
    ({ memberId, adminOf } = await requireUser(req));
  } catch (e) {
    return res.status(e.status || 401).json({ error: 'Unauthorized' });
  }

  // CH exige identidade de membro — EXCETO admin fora da escala (memberId null),
  // que sempre opera sobre um membro-alvo via ?person (GET) ou body.person (POST).
  if (!memberId && !isPrivileged(adminOf)) return res.status(403).json({ error: 'Forbidden' });

  try {
    if (req.method === 'GET') {
      const requestedPerson = typeof req.query.person === 'string' ? req.query.person : null;
      const target = (isPrivileged(adminOf) && requestedPerson) ? requestedPerson : memberId;
      if (!target) return res.status(400).json({ error: 'Bad request' });
      if (isPrivileged(adminOf) && requestedPerson && !canAccessMember({ memberId, adminOf }, target)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const [entries, params] = await Promise.all([
        kvGet(`member:${target}:ch_entries`),
        kvGet(`member:${target}:ch_params`),
      ]);
      return res.status(200).json({ entries: entries ?? [], params: params ?? {} });
    }

    if (req.method === 'POST') {
      if (!checkBodySize(req.body)) return res.status(400).json({ error: 'Bad request' });
      const { ok, data: body } = validate(ChPostSchema, req.body);
      if (!ok) return res.status(400).json({ error: 'Bad request' });

      const { entries, params, person: bodyPerson } = body;
      const target = (isPrivileged(adminOf) && bodyPerson) ? bodyPerson : memberId;
      // Admin fora da escala precisa indicar o membro-alvo — nunca grava em member:null:*
      if (!target) return res.status(400).json({ error: 'Bad request' });
      if (isPrivileged(adminOf) && bodyPerson && !canAccessMember({ memberId, adminOf }, target)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      await Promise.all([
        entries !== undefined ? kvSet(`member:${target}:ch_entries`, entries) : Promise.resolve(),
        params  !== undefined ? kvSet(`member:${target}:ch_params`,  params)  : Promise.resolve(),
      ]);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[ch] error:', e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
