import { kv } from '@vercel/kv';

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
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  if (req.method === 'GET') {
    const [entries, params] = await Promise.all([
      kv.get('ch_entries'),
      kv.get('ch_params'),
    ]);
    return res.status(200).json({ entries: entries ?? [], params: params ?? {} });
  }

  if (req.method === 'POST') {
    const { entries, params } = req.body;
    await Promise.all([
      entries !== undefined ? kv.set('ch_entries', entries) : Promise.resolve(),
      params  !== undefined ? kv.set('ch_params',  params)  : Promise.resolve(),
    ]);
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST');
  res.status(405).json({ error: 'Method not allowed' });
}
