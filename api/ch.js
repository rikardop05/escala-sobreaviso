import { kvGet, kvSet } from './_redis.js';
import { requireUser } from './_auth.js';

// Keys use memberId (not userId) so the admin can read/write any member's data.
// ⚠ Migration note: previous keys were 'user:{clerkId}:ch_*'.
//   Existing CH data must be manually re-entered after this change.

export default async function handler(req, res) {
  let memberId, role;
  try {
    ({ memberId, role } = await requireUser(req));
  } catch (e) {
    return res.status(e.status || 401).json({ error: 'Unauthorized' });
  }

  // CH requires a valid team member identity
  if (!memberId) return res.status(403).json({ error: 'Forbidden' });

  try {
    if (req.method === 'GET') {
      // Admin can query any member's data via ?person=Name
      const target = (role === 'admin' && req.query.person) ? req.query.person : memberId;
      const [entries, params] = await Promise.all([
        kvGet(`member:${target}:ch_entries`),
        kvGet(`member:${target}:ch_params`),
      ]);
      return res.status(200).json({ entries: entries ?? [], params: params ?? {} });
    }

    if (req.method === 'POST') {
      const { entries, params, person: bodyPerson } = req.body;
      // Admin can write to any member's data via body.person
      const target = (role === 'admin' && bodyPerson) ? bodyPerson : memberId;
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
