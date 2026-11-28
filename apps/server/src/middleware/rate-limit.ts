/**
 * Rate limits (LLD §15.1) on Redis: 5 sign-in attempts per minute per IP, 60 requests per minute per teacher.
 * If Redis is unreachable, an in-memory limiter takes over rather than letting requests through unlimited.
 */
import type { RequestHandler } from 'express';
import type { Redis } from 'ioredis';
import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import { AppError } from '../errors.ts';

function limiter(redis: Redis, keyPrefix: string, points: number) {
  return new RateLimiterRedis({
    storeClient: redis,
    keyPrefix,
    points,
    duration: 60,
    insuranceLimiter: new RateLimiterMemory({ keyPrefix: `${keyPrefix}_mem`, points, duration: 60 }),
  });
}

function middleware(l: RateLimiterRedis, key: (req: Parameters<RequestHandler>[0]) => string): RequestHandler {
  return async (req, res, next) => {
    try {
      await l.consume(key(req));
      next();
    } catch (err) {
      if (err instanceof RateLimiterRes) {
        res.setHeader('Retry-After', String(Math.ceil(err.msBeforeNext / 1000)));
        return next(new AppError('RATE_LIMITED', 'Too many requests. Please wait a minute and try again.'));
      }
      next(err);
    }
  };
}

export const signInLimit = (redis: Redis, perMinute = 5) =>
  middleware(limiter(redis, 'rl_signin', perMinute), (req) => req.ip ?? 'unknown');
export const teacherLimit = (redis: Redis, perMinute = 60) =>
  middleware(limiter(redis, 'rl_teacher', perMinute), (req) => req.identity?.userId ?? req.ip ?? 'unknown');
