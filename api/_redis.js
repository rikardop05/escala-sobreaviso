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
