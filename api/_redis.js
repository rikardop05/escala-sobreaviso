import Redis from 'ioredis';

// enableOfflineQueue defaults to true — required so commands issued during a
// serverless cold start are queued until the connection is ready, not dropped.
const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 3,
});

export const kvGet = async (key) => {
  const val = await redis.get(key);
  return val ? JSON.parse(val) : null;
};

export const kvSet = async (key, value) => {
  await redis.set(key, JSON.stringify(value));
};

// Percorre TODAS as chaves via SCAN (não bloqueia como KEYS) e devolve
// { key: valorParseado }. Usado só pelo backup — pega qualquer chave, mesmo
// tipos de dado adicionados no futuro, sem precisar manter uma lista.
export const kvScanAll = async () => {
  const out = {};
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'COUNT', 200);
    cursor = next;
    if (keys.length) {
      const values = await redis.mget(keys);
      keys.forEach((k, i) => {
        const v = values[i];
        if (v == null) return;
        try { out[k] = JSON.parse(v); } catch { out[k] = v; } // preserva não-JSON como string
      });
    }
  } while (cursor !== '0');
  return out;
};
