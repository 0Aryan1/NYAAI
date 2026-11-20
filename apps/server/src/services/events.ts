/**
 * Live events (LLD §4.4, §5.1): a job publishes small events for one teacher; the API relays them to her open
 * streams. Each event gets an increasing id and the last 100 are kept for 10 minutes, so a stream that reconnects
 * with Last-Event-ID misses nothing. Events carry ids and stages only, never lecture text (HLD D4).
 */
import type { Redis } from 'ioredis';
import type { LiveEvent } from '@nyaai/shared';

const BUFFER = 100;
const BUFFER_TTL_S = 600;

export const channelFor = (userId: string) => `events:${userId}`;
const bufferFor = (userId: string) => `events:buf:${userId}`;
const seqFor = (userId: string) => `events:seq:${userId}`;

export interface StoredEvent {
  id: number;
  event: LiveEvent;
}

export async function publishEvent(redis: Redis, userId: string, event: LiveEvent): Promise<number> {
  const id = await redis.incr(seqFor(userId));
  const payload = JSON.stringify({ id, event } satisfies StoredEvent);
  await redis.multi().lpush(bufferFor(userId), payload).ltrim(bufferFor(userId), 0, BUFFER - 1).expire(bufferFor(userId), BUFFER_TTL_S).expire(seqFor(userId), 86_400).exec();
  await redis.publish(channelFor(userId), payload);
  return id;
}

/** Events after `lastId`, oldest first (for Last-Event-ID resume). */
export async function eventsSince(redis: Redis, userId: string, lastId: number): Promise<StoredEvent[]> {
  const raw = await redis.lrange(bufferFor(userId), 0, BUFFER - 1);
  return raw
    .map((r) => JSON.parse(r) as StoredEvent)
    .filter((e) => e.id > lastId)
    .sort((a, b) => a.id - b.id);
}
