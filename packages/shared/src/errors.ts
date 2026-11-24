import { z } from 'zod';

/** Stable error codes the web app switches on (LLD §2, Error format). Extend as endpoints land. */
export const ErrorCode = z.enum([
  'VALIDATION_FAILED',
  'NOT_SIGNED_IN',
  'FORBIDDEN',
  'NOT_FOUND',
  'VERSION_CONFLICT',
  'COURSE_REQUIRED',
  'TOPIC_AMBIGUOUS',
  'PREREQ_WARNING_UNACKED',
  'BUDGET_EXHAUSTED',
  'COVERAGE_CHANGED',
  'GAP_CLOSED',
  'ALREADY_IN_LIBRARY',
  'NOT_A_PDF',
  'UNSUPPORTED_FILE',
  'NOTES_NOT_READY',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** Every API error has this shape: `message` is plain teacher-facing English, never AI terms. */
export const ApiError = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    traceId: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export const HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  NOT_SIGNED_IN: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  COURSE_REQUIRED: 400,
  TOPIC_AMBIGUOUS: 409,
  COVERAGE_CHANGED: 409,
  GAP_CLOSED: 409,
  ALREADY_IN_LIBRARY: 409,
  NOT_A_PDF: 415,
  UNSUPPORTED_FILE: 415,
  NOTES_NOT_READY: 409,
  PREREQ_WARNING_UNACKED: 422,
  BUDGET_EXHAUSTED: 422,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL: 500,
};
