import { HTTP_STATUS, type ErrorCode } from '@nyaai/shared';

/** Throw from handlers; the error middleware turns it into the LLD §2 error shape. */
export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = HTTP_STATUS[code];
  }
}

/**
 * An outside service did not answer as it should (Claude, Voyage, Indian Kanoon, file storage). On a request, the
 * error middleware answers 503 SERVICE_UNAVAILABLE with a plain message ("try again in a little while"), never a 500;
 * in a job, it counts as an outage and the job is retried. `service` names it in words a teacher understands.
 */
export class ExternalServiceError extends Error {
  constructor(
    readonly service: string,
    message: string,
  ) {
    super(message);
    this.name = 'ExternalServiceError';
  }
}
