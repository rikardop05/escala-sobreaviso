import { verifyToken } from '@clerk/backend';
import { kv } from '@vercel/kv';

async function getUserId(req) {
  const token = req.headers['authorization']?.slice(7);
  if (!token) throw Object.assign(new Error('Unauthorized'), { status: 401 });
  const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
  return payload.sub;
}

export default async function handler(req, res) {
  let userId;
  try { userId = await getUserId(req); }
  catch (e) {
    console.error('[profile] auth error:', e.message);
    return res.status(e.status || 401).json({ error: e.message });
  }

  try {
    if (req.method === 'GET') {
      const profile = await kv.get(`user:${userId}:profile`) ?? {};
      return res.status(200).json(profile);
    }

    if (req.method === 'POST') {
      await kv.set(`user:${userId}:profile`, req.body);
      return res.status(200).json(req.body);
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[profile] kv error:', e.message);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
