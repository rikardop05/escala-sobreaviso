import { kv } from '@vercel/kv';

// Decodifica o JWT localmente sem chamada de rede (adequado para app interno)
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
  let userId;
  try { userId = getUserId(req); }
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
