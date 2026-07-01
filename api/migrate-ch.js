// Endpoint temporário de migração — REMOVER APÓS USO
//
// Lê chaves antigas (user:{clerkId}:ch_*) e copia para novas (member:{memberId}:ch_*)
// sem sobrescrever dados já existentes no novo formato.
//
// Requer auth admin.
// GET  /api/migrate-ch          → lista o que há nas chaves antigas
// POST /api/migrate-ch          → executa a cópia para as novas chaves
//   body: { mapping: { "{clerkId}": "{memberId}" } }

import { requireUser } from './_auth.js';
import { kvGet, kvSet } from './_redis.js';

export default async function handler(req, res) {
  let role;
  try {
    ({ role } = await requireUser(req));
  } catch (e) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

  try {
    // Importa Redis direto para usar KEYS (kvGet/kvSet não expõe scan)
    const { default: Redis } = await import('ioredis');
    const redis = new Redis(process.env.REDIS_URL);

    if (req.method === 'GET') {
      // Lista todas as chaves antigas e seu conteúdo
      const keys = await redis.keys('user:*:ch_*');
      const result = {};
      for (const key of keys.sort()) {
        const val = await redis.get(key);
        result[key] = JSON.parse(val || 'null');
      }
      redis.disconnect();
      return res.status(200).json({ keys: Object.keys(result), data: result });
    }

    if (req.method === 'POST') {
      // { mapping: { clerkId: memberId } }
      const { mapping } = req.body || {};
      if (!mapping || typeof mapping !== 'object') {
        redis.disconnect();
        return res.status(400).json({ error: 'mapping obrigatório: { clerkId: memberId }' });
      }

      const report = [];

      for (const [clerkId, memberId] of Object.entries(mapping)) {
        for (const suffix of ['ch_entries', 'ch_params']) {
          const oldKey = `user:${clerkId}:${suffix}`;
          const newKey = `member:${memberId}:${suffix}`;

          const oldVal = await redis.get(oldKey);
          if (!oldVal) {
            report.push({ oldKey, status: 'sem dados na chave antiga' });
            continue;
          }

          const newVal = await redis.get(newKey);
          if (newVal) {
            report.push({ oldKey, newKey, status: 'novo formato já tem dados — não sobrescrito' });
            continue;
          }

          await redis.set(newKey, oldVal);
          report.push({ oldKey, newKey, status: 'copiado com sucesso' });
        }
      }

      redis.disconnect();
      return res.status(200).json({ report });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[migrate-ch] error:', e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
