import { kvGet, kvSet, kvGetWithFallback } from './_redis.js';
import { requireUser } from './_auth.js';
import { adminCovers } from './_allowlist.js';
import { validate, checkBodySize, TeamIdSchema, subPostSchemaFor } from './_validate.js';

// Fase 1 da spec de múltiplas equipes (docs/specs/multi-equipe.md §3/§4): a equipe é
// explícita — GET aceita ?team= (default sustentacao, para não quebrar o cliente
// antes do seletor de equipe existir); POST/DELETE exigem `team` e checam escopo:
// admin da equipe, OU member que é o próprio titular/substituto da substituição.
const LEGACY_TEAM_ID = 'sustentacao'; // única equipe com chave global anterior à Fase 0
const keyFor = (teamId) => `team:${teamId}:substitutions`;

async function readSubs(teamId) {
  const key = keyFor(teamId);
  if (teamId === LEGACY_TEAM_ID) return (await kvGetWithFallback(key, 'substitutions')) ?? [];
  return (await kvGet(key)) ?? [];
}

export default async function handler(req, res) {
  try {
    // GET is public — anyone can read substitutions
    if (req.method === 'GET') {
      const teamId = typeof req.query.team === 'string' ? req.query.team : LEGACY_TEAM_ID;
      if (!TeamIdSchema.safeParse(teamId).success) return res.status(400).json({ error: 'Bad request' });
      return res.status(200).json(await readSubs(teamId));
    }

    let memberId, adminOf, role;
    try {
      ({ memberId, adminOf, role } = await requireUser(req));
    } catch (e) {
      return res.status(e.status || 401).json({ error: 'Unauthorized' });
    }

    if (req.method === 'POST') {
      if (role === 'viewer') return res.status(403).json({ error: 'Forbidden' });
      if (!checkBodySize(req.body)) return res.status(400).json({ error: 'Bad request' });

      const teamCheck = TeamIdSchema.safeParse(req.body?.team);
      if (!teamCheck.success) return res.status(400).json({ error: 'Bad request' });
      const teamId = teamCheck.data;

      const { ok, data: body } = validate(subPostSchemaFor(teamId), req.body);
      if (!ok) return res.status(400).json({ error: 'Bad request' });

      const { titular, substituto } = body;
      // Admin da equipe pode criar qualquer uma; member só as que envolvem seu próprio memberId
      if (!adminCovers(adminOf, teamId) && titular !== memberId && substituto !== memberId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const subs = await readSubs(teamId);
      const newSub = { titular, substituto, from: body.from, until: body.until, id: String(Date.now()) };
      await kvSet(keyFor(teamId), [...subs, newSub]);
      return res.status(200).json(newSub);
    }

    if (req.method === 'DELETE') {
      if (role === 'viewer') return res.status(403).json({ error: 'Forbidden' });

      const { id, team } = req.query;
      if (!id || typeof id !== 'string' || id.trim() === '') {
        return res.status(400).json({ error: 'Bad request' });
      }
      const teamCheck = TeamIdSchema.safeParse(team);
      if (!teamCheck.success) return res.status(400).json({ error: 'Bad request' });
      const teamId = teamCheck.data;

      const subs = await readSubs(teamId);
      const target = subs.find(s => s.id === id);
      if (!target) return res.status(404).json({ error: 'Not found' });
      // Admin da equipe pode remover qualquer uma; member só as que envolvem seu próprio memberId
      if (!adminCovers(adminOf, teamId) && target.titular !== memberId && target.substituto !== memberId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      await kvSet(keyFor(teamId), subs.filter(s => s.id !== id));
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[substitutions] error:', e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
