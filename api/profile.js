import { kvGet, kvSet } from './_redis.js';
import { requireUser } from './_auth.js';

export default async function handler(req, res) {
  let userId;
  try {
    ({ userId } = await requireUser(req));
  } catch (e) {
    return res.status(e.status || 401).json({ error: 'Unauthorized' });
  }

  try {
    if (req.method === 'GET') {
      const profile = await kvGet(`user:${userId}:profile`) ?? {};
      return res.status(200).json(profile);
    }
    if (req.method === 'POST') {
      await kvSet(`user:${userId}:profile`, req.body);
      return res.status(200).json(req.body);
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[profile] error:', e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
