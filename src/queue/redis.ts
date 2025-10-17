import type { RedisOptions } from 'ioredis';

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
    cachedConnectionOptions = {
      connectionString: url,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    };
    return cachedConnectionOptions;
  }

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
    ...(useTls ? { tls: {} } : {}),
  };

  return cachedConnectionOptions;
}
