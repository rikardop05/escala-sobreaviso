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
    const subs = await kv.get('substitutions') ?? [];
    return res.status(200).json(subs);
  }

  if (req.method === 'POST') {
    const subs = await kv.get('substitutions') ?? [];
    const newSub = { ...req.body, id: String(Date.now()) };
    await kv.set('substitutions', [...subs, newSub]);
    return res.status(200).json(newSub);
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    const subs = (await kv.get('substitutions') ?? []).filter(s => s.id !== id);
    await kv.set('substitutions', subs);
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  res.status(405).json({ error: 'Method not allowed' });
}
