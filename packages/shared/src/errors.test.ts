import { describe, expect, it } from 'vitest';
import { ApiError, ErrorCode, HTTP_STATUS } from './errors.ts';

describe('ApiError', () => {
  it('accepts the LLD §2 error shape', () => {
    const parsed = ApiError.parse({
      error: {
        code: 'COURSE_REQUIRED',
        message: "Choose a course or 'No course, one-off' first.",
        details: { field: 'courseId' },
        traceId: '7f3c',
      },
    });
    expect(parsed.error.code).toBe('COURSE_REQUIRED');
  });

  it('has an HTTP status for every code', () => {
    for (const code of ErrorCode.options) expect(HTTP_STATUS[code]).toBeGreaterThanOrEqual(400);
  });
});
