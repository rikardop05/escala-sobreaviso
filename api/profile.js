import { kvGet, kvSet } from './_redis.js';
import { requireUser } from './_auth.js';

// Only user preferences are stored in Redis (dark, filter, monthKey).
// memberId and role are always derived from the allowlist — never from stored data.

export default async function handler(req, res) {
  let userId, memberId, role;
  try {
    ({ userId, memberId, role } = await requireUser(req));
  } catch (e) {
    return res.status(e.status || 401).json({ error: 'Unauthorized' });
  }

  try {
    if (req.method === 'GET') {
      const stored = await kvGet(`user:${userId}:profile`) ?? {};
      return res.status(200).json({
        memberId,
        role,
        dark:     stored.dark     ?? false,
        filter:   stored.filter   ?? null,
        monthKey: stored.monthKey ?? null,
      });
    }

    if (req.method === 'POST') {
      const stored = await kvGet(`user:${userId}:profile`) ?? {};
      const { dark, filter, monthKey } = req.body;
      if (typeof dark === 'boolean') stored.dark = dark;
      if (filter   !== undefined)    stored.filter   = filter;
      if (monthKey !== undefined)    stored.monthKey = monthKey;
      await kvSet(`user:${userId}:profile`, stored);
      return res.status(200).json({
        memberId,
        role,
        dark:     stored.dark     ?? false,
        filter:   stored.filter   ?? null,
        monthKey: stored.monthKey ?? null,
      });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[profile] error:', e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
