import { kvGet, kvSet } from './_redis.js';
import { requireUser } from './_auth.js';

// Keys are now namespaced per user, fixing the IDOR where any authenticated
// user could read/overwrite any other user's financial data.
// Note: data previously stored under the global keys 'ch_entries' / 'ch_params'
// will no longer be found. Each user starts with a clean slate under their own key.

export default async function handler(req, res) {
  let userId;
  try {
    ({ userId } = await requireUser(req));
  } catch (e) {
    return res.status(e.status || 401).json({ error: 'Unauthorized' });
  }

  try {
    if (req.method === 'GET') {
      const [entries, params] = await Promise.all([
        kvGet(`user:${userId}:ch_entries`),
        kvGet(`user:${userId}:ch_params`),
      ]);
      return res.status(200).json({ entries: entries ?? [], params: params ?? {} });
    }

    if (req.method === 'POST') {
      const { entries, params } = req.body;
      await Promise.all([
        entries !== undefined ? kvSet(`user:${userId}:ch_entries`, entries) : Promise.resolve(),
        params  !== undefined ? kvSet(`user:${userId}:ch_params`,  params)  : Promise.resolve(),
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
