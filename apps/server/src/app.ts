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
import { notesRouter } from './api/notes.ts';
import { accountRouter } from './api/account.ts';
import { searchRouter, type SearchApiDeps } from './api/search.ts';
import { errorHandler, notFound } from './middleware/error.ts';
import { requireAuth } from './middleware/auth.ts';
import { requireCsrf } from './auth/csrf.ts';
import { teacherLimit } from './middleware/rate-limit.ts';
import { GoogleSignIn } from './auth/google.ts';
import type { BuildJobData, CheckJobData, IngestJobData, LearnJobData, OpsJobData } from './jobs/queues.ts';
import { slidesRouter } from './api/slides.ts';
import { coursesRouter } from './api/courses.ts';
import type { Storage } from './services/storage/index.ts';
import { lecturesRouter } from './api/lectures.ts';
import { reviewRouter } from './api/review.ts';

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Path prefixes that need a signed-in teacher (everything except health and sign-in). */
const SIGNED_IN = ['/me', '/setup', '/consents', '/home', '/library', '/suggest', '/topics', '/events', '/lectures', '/citations', '/coverage', '/courses', '/slides', '/notes'];

export interface AppDeps {
  config: Config;
  logger: Logger;
  pool: pg.Pool;
  redis: Redis;
  queues?: { ingest?: Queue<IngestJobData>; build?: Queue<BuildJobData>; learn?: Queue<LearnJobData>; check?: Queue<CheckJobData>; ops?: Queue<OpsJobData> };
  search?: Omit<SearchApiDeps, 'redis'>;
  /** File storage, for judgment uploads (library editor). */
  storage?: Storage;
}

export function createApp({ config, logger, pool, redis, queues, search, storage }: AppDeps) {
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
          config.GOOGLE_SKIP_HD_CHECK ? undefined : config.ALLOWED_EMAIL_DOMAINS[0],
          config.SESSION_SECRET,
        )
      : null;

  const v1 = express.Router();
  v1.use(healthRouter({ pool, redis }));
  v1.use(authRouter({ config, pool, redis, google }));
  v1.use(SIGNED_IN, requireAuth({ pool, sessionSecret: config.SESSION_SECRET, production }), teacherLimit(redis, config.RATE_LIMIT_PER_MIN), requireCsrf(config.CSRF_SECRET));
  v1.use(meRouter(config), accountRouter(queues?.ops, storage), setupRouter(), homeRouter(), libraryRouter(queues?.ingest, storage), notesRouter(queues?.ingest, storage), lecturesRouter(queues?.build, queues?.learn), reviewRouter(), coursesRouter(queues?.ingest), slidesRouter(queues?.check));
  v1.use(searchRouter({ redis, voyage: search?.voyage ?? null, gateway: search?.gateway ?? null, minScore: search?.minScore ?? config.RERANK_MIN_SCORE }));
  app.use('/api/v1', v1);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
