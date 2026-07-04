import { put, list, del } from '@vercel/blob';
import { kvScanAll } from './_redis.js';
import { requireUser } from './_auth.js';
import { encrypt } from './_backup-crypto.js';

// Backup diário do Redis → Vercel Blob (cifrado). Disparado pelo Vercel Cron
// (ver crons em vercel.json) ou manualmente por um admin autenticado.
//
// Fluxo: SCAN de todas as chaves → JSON → AES-256-GCM → upload em
// backups/escala-YYYY-MM-DD-<sufixo>.enc → poda dumps com mais de RETENTION_DAYS.
//
// Env vars necessárias no Vercel:
//   REDIS_URL              (já existe)
//   BLOB_READ_WRITE_TOKEN  (criado ao adicionar um Blob Store no painel)
//   BACKUP_ENCRYPTION_KEY  (32 bytes hex/base64 — ver api/_backup-crypto.js)
//   CRON_SECRET            (o Vercel envia Authorization: Bearer <CRON_SECRET> no cron)

const RETENTION_DAYS = 30;
const PREFIX = 'backups/';

// Autoriza: chamada do Vercel Cron (Bearer CRON_SECRET) OU admin autenticado (trigger manual)
async function authorize(req) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization === `Bearer ${secret}`) return true;
  try {
    const { role } = await requireUser(req);
    return role === 'admin';
  } catch {
    return false;
  }
}

// Extrai a data (YYYY-MM-DD) do nome do blob backups/escala-YYYY-MM-DD-<sufixo>.enc
function dateFromPath(pathname) {
  const m = pathname.match(/escala-(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await authorize(req))) return res.status(401).json({ error: 'Unauthorized' });

  try {
    // 1. Dump de todas as chaves
    const data = await kvScanAll();
    const keyCount = Object.keys(data).length;
    const now = new Date();
    const stamp = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const payload = JSON.stringify({ version: 1, createdAt: now.toISOString(), keyCount, data });

    // 2. Cifra e sobe
    const encrypted = encrypt(payload);
    const { url, pathname } = await put(`${PREFIX}escala-${stamp}.enc`, encrypted, {
      access: 'public',        // URL pública com sufixo aleatório; o conteúdo é cifrado
      addRandomSuffix: true,
      contentType: 'application/octet-stream',
    });

    // 3. Poda dumps antigos (> RETENTION_DAYS)
    const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86400000).toISOString().slice(0, 10);
    let pruned = 0;
    const { blobs } = await list({ prefix: PREFIX });
    const stale = blobs.filter(b => {
      const d = dateFromPath(b.pathname);
      return d && d < cutoff;
    });
    if (stale.length) {
      await del(stale.map(b => b.url));
      pruned = stale.length;
    }

    console.log(`[backup] ok — ${keyCount} chaves, ${(encrypted.length / 1024).toFixed(1)}KB, podados ${pruned}`);
    return res.status(200).json({ ok: true, keyCount, pathname, url, pruned });
  } catch (e) {
    console.error('[backup] error:', e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
