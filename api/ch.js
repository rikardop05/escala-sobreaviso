import { createClerkClient } from '@clerk/backend';
import { kv } from '@vercel/kv';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

async function getUserId(req) {
  const token = req.headers['authorization']?.slice(7);
  if (!token) throw Object.assign(new Error('Unauthorized'), { status: 401 });
  const payload = await clerk.verifyToken(token);
  return payload.sub;
}

export default async function handler(req, res) {
  try { await getUserId(req); }
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
