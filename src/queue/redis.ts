import type { RedisOptions } from 'ioredis';
import { URL } from 'url';

export type BullRedisConnection = RedisOptions & {
  connectionString?: string;
};

let cachedConnectionOptions: BullRedisConnection | null = null;

export function getRedisConnectionOptions(): BullRedisConnection {
  if (cachedConnectionOptions) {
    return cachedConnectionOptions;
  }

  const url = process.env.REDIS_URL;
  if (url) {
    console.log('✅ Using REDIS_URL for Redis connection');
    const redisUrl = new URL(url);

    cachedConnectionOptions = {
      host: redisUrl.hostname,
      port: Number(redisUrl.port || '6379'),
      username: redisUrl.username || undefined,
      password: redisUrl.password || undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      connectTimeout: Number.parseInt(process.env.REDIS_CONNECT_TIMEOUT_MS ?? '10000', 10),
      keepAlive: Number.parseInt(process.env.REDIS_KEEP_ALIVE_MS ?? '120000', 10),
      retryStrategy: (times) => Math.min(times * 500, 5000),
      reconnectOnError: (error) => {
        const message = error?.message ?? '';
        if (message.includes('READONLY') || message.includes('ECONNRESET')) {
          return true;
        }
        return false;
      },
      enableOfflineQueue: false,
    };

    if (redisUrl.protocol === 'rediss:') {
      console.log('   🔒 TLS enabled for Redis connection.');
      const rejectUnauthorized =
        process.env.REDIS_TLS_REJECT_UNAUTHORIZED === 'true' ||
        process.env.REDIS_TLS_REJECT_UNAUTHORIZED === undefined;
      cachedConnectionOptions.tls = {
        rejectUnauthorized,
      };
    }

    return cachedConnectionOptions;
  }

  console.warn('⚠️ REDIS_URL not found. Falling back to individual REDIS_* variables.');
  const host = process.env.REDIS_HOST ?? '127.0.0.1';
  const port = Number.parseInt(process.env.REDIS_PORT ?? '6379', 10);
  const username = process.env.REDIS_USERNAME;
  const password = process.env.REDIS_PASSWORD;
  const useTls = process.env.REDIS_TLS === 'true';

  cachedConnectionOptions = {
    host,
    port,
    username,
    password,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: Number.parseInt(process.env.REDIS_CONNECT_TIMEOUT_MS ?? '10000', 10),
    keepAlive: Number.parseInt(process.env.REDIS_KEEP_ALIVE_MS ?? '120000', 10),
    retryStrategy: (times) => Math.min(times * 500, 5000),
    reconnectOnError: (error) => {
      const message = error?.message ?? '';
      if (message.includes('READONLY') || message.includes('ECONNRESET')) {
        return true;
      }
      return false;
    },
    enableOfflineQueue: false,
    ...(useTls ? { tls: {} } : {}),
  };

  return cachedConnectionOptions;
}
