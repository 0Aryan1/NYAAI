import { randomUUID } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import type { Queue } from 'bullmq';
import './http.ts';
import type { Config } from './config.ts';
import type { Logger } from './logger.ts';
import { healthRouter } from './api/health.ts';
import { authRouter } from './api/auth.ts';
import { meRouter } from './api/me.ts';
import { setupRouter } from './api/setup.ts';
import { homeRouter } from './api/home.ts';
import { libraryRouter } from './api/library.ts';
import { errorHandler, notFound } from './middleware/error.ts';
import { requireAuth } from './middleware/auth.ts';
import { requireCsrf } from './auth/csrf.ts';
import { teacherLimit } from './middleware/rate-limit.ts';
import { GoogleSignIn } from './auth/google.ts';
import type { IngestJobData } from './jobs/queues.ts';

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Path prefixes that need a signed-in teacher (everything except health and sign-in). */
const SIGNED_IN = ['/me', '/setup', '/consents', '/home', '/library'];

export interface AppDeps {
  config: Config;
  logger: Logger;
  pool: pg.Pool;
  redis: Redis;
  queues?: { ingest: Queue<IngestJobData> };
}

export function createApp({ config, logger, pool, redis, queues }: AppDeps) {
  const app = express();
  const production = config.NODE_ENV === 'production';
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));

  const google =
    config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
      ? new GoogleSignIn(
          config.GOOGLE_CLIENT_ID,
          config.GOOGLE_CLIENT_SECRET,
          `${config.WEB_ORIGIN}/api/v1/auth/google/callback`,
          config.ALLOWED_EMAIL_DOMAINS[0],
          config.SESSION_SECRET,
        )
      : null;

  const v1 = express.Router();
  v1.use(healthRouter({ pool, redis }));
  v1.use(authRouter({ config, pool, redis, google }));
  v1.use(SIGNED_IN, requireAuth({ pool, sessionSecret: config.SESSION_SECRET, production }), teacherLimit(redis), requireCsrf(config.CSRF_SECRET));
  v1.use(meRouter(config), setupRouter(), homeRouter(), libraryRouter(queues?.ingest));
  app.use('/api/v1', v1);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
