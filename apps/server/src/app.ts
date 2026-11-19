import { randomUUID } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import type { Config } from './config.ts';
import type { Logger } from './logger.ts';
import { healthRouter } from './api/health.ts';
import { errorHandler, notFound } from './middleware/error.ts';

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

export interface AppDeps {
  config: Config;
  logger: Logger;
  pool: pg.Pool;
  redis: Redis;
}

export function createApp({ config, logger, pool, redis }: AppDeps) {
  const app = express();
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
  app.use(express.json({ limit: '1mb' }));

  const v1 = express.Router();
  v1.use(healthRouter({ pool, redis }));
  app.use('/api/v1', v1);

  app.use(notFound);
  app.use(errorHandler);
  void config;
  return app;
}
