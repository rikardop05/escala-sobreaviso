import { kvGet, kvSet } from './_redis.js';
import { requireUser } from './_auth.js';

export default async function handler(req, res) {
  try {
    await requireUser(req);
  } catch (e) {
    return res.status(e.status || 401).json({ error: 'Unauthorized' });
  }

  try {
    if (req.method === 'GET') {
      const subs = await kvGet('substitutions') ?? [];
      return res.status(200).json(subs);
    }
    if (req.method === 'POST') {
      const subs = await kvGet('substitutions') ?? [];
      const newSub = { ...req.body, id: String(Date.now()) };
      await kvSet('substitutions', [...subs, newSub]);
      return res.status(200).json(newSub);
    }
    if (req.method === 'DELETE') {
      const { id } = req.query;
      const subs = (await kvGet('substitutions') ?? []).filter(s => s.id !== id);
      await kvSet('substitutions', subs);
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[substitutions] error:', e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
