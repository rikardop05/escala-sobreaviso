import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
});

export const kvGet = async (key) => {
  const val = await redis.get(key);
  return val ? JSON.parse(val) : null;
};

export const kvSet = async (key, value) => {
  await redis.set(key, JSON.stringify(value));
};
