import { Redis } from 'ioredis';

/** BullMQ requires maxRetriesPerRequest: null on its connections. */
export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false });
}
