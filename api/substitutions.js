import { kvGet, kvSet } from './_redis.js';
import { requireUser } from './_auth.js';

export default async function handler(req, res) {
  let memberId, role;
  try {
    ({ memberId, role } = await requireUser(req));
  } catch (e) {
    return res.status(e.status || 401).json({ error: 'Unauthorized' });
  }

  try {
    if (req.method === 'GET') {
      const subs = await kvGet('substitutions') ?? [];
      return res.status(200).json(subs);
    }

    if (req.method === 'POST') {
      if (role === 'viewer') return res.status(403).json({ error: 'Forbidden' });
      const { titular, substituto } = req.body;
      // Member can only create substitutions that involve their own memberId
      if (role === 'member' && titular !== memberId && substituto !== memberId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const subs = await kvGet('substitutions') ?? [];
      const newSub = { ...req.body, id: String(Date.now()) };
      await kvSet('substitutions', [...subs, newSub]);
      return res.status(200).json(newSub);
    }

    if (req.method === 'DELETE') {
      if (role === 'viewer') return res.status(403).json({ error: 'Forbidden' });
      const { id } = req.query;
      const subs = await kvGet('substitutions') ?? [];
      const target = subs.find(s => s.id === id);
      if (!target) return res.status(404).json({ error: 'Not found' });
      // Member can only delete substitutions where they appear as titular or substituto
      if (role === 'member' && target.titular !== memberId && target.substituto !== memberId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      await kvSet('substitutions', subs.filter(s => s.id !== id));
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[substitutions] error:', e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
