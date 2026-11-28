import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ApiError } from '@nyaai/shared';
import { AppError, ExternalServiceError } from '../errors.ts';

function traceId(req: Parameters<RequestHandler>[0]): string {
  return String(req.id ?? 'unknown');
}

export const notFound: RequestHandler = (req, res) => {
  const body: ApiError = { error: { code: 'NOT_FOUND', message: 'We could not find that.', traceId: traceId(req) } };
  res.status(404).json(body);
};

/** Every error leaves the API in one shape; messages are plain teacher-facing English (NFR-12). */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let body: ApiError;
  let status: number;
  if (err instanceof AppError) {
    status = err.status;
    body = {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
        traceId: traceId(req),
      },
    };
  } else if (err instanceof ExternalServiceError) {
    // Claude, Voyage, Indian Kanoon or storage did not answer: she is told to try again, and it is logged as an
    // outage (a warning), not as a fault in NYAAI.
    status = 503;
    req.log?.warn({ err, service: err.service }, 'an outside service did not answer');
    body = {
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: `${err.service} is not available right now. Try again in a little while.`,
        traceId: traceId(req),
      },
    };
  } else if (err instanceof ZodError) {
    status = 400;
    body = {
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Some of the details sent were not valid.',
        details: { issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
        traceId: traceId(req),
      },
    };
  } else {
    status = 500;
    req.log?.error({ err }, 'unhandled error');
    body = {
      error: {
        code: 'INTERNAL',
        message: 'Something went wrong on our side. Please try again.',
        traceId: traceId(req),
      },
    };
  }
  res.status(status).json(body);
};
