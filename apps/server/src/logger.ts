import pino from 'pino';
import type { Config } from './config.ts';

/** Structured JSON logs (LLD §15.2). Secrets, cookies and slide text are redacted. */
export function createLogger(config: Pick<Config, 'LOG_LEVEL' | 'NODE_ENV' | 'APP_ROLE'>) {
  return pino({
    level: config.LOG_LEVEL,
    base: { role: config.APP_ROLE },
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'req.headers["x-csrf-token"]',
        'res.headers["set-cookie"]',
        '*.body',
        '*.text',
      ],
      censor: '[redacted]',
    },
    ...(config.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } } }
      : {}),
  });
}
export type Logger = ReturnType<typeof createLogger>;
