import { kvGet, kvSet } from './_redis.js';

function getUserId(req) {
  const token = req.headers['authorization']?.slice(7);
  if (!token) throw Object.assign(new Error('Sem autorização'), { status: 401 });
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    if (!payload.sub) throw new Error('Token sem subject');
    return payload.sub;
  } catch {
    throw Object.assign(new Error('Token inválido'), { status: 401 });
  }
}

export default async function handler(req, res) {
  try { getUserId(req); }
  catch (e) {
    console.error('[substitutions] auth error:', e.message);
    return res.status(e.status || 401).json({ error: e.message });
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
    console.error('[substitutions] redis error:', e.message);
    return res.status(500).json({ error: 'Erro interno: ' + e.message });
  }
}
