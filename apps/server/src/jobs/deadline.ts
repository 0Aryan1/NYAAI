/**
 * A job's time limit that really stops the work. When the time is up, the job's AbortSignal fires: an AI call in
 * flight is cancelled, a retry wait ends, and the long services stop at their next stage. The job then waits for the
 * work to stop before it reports the timeout, so BullMQ's retry never runs beside an attempt that is still writing.
 * (The old way, racing a timer, reported the timeout while the work went on.) Work already saved stays saved: builds
 * and research runs resume from it on the next attempt.
 */
export class JobTimeoutError extends Error {
  constructor(
    readonly code: string,
    readonly limitMs: number,
  ) {
    super(`the job took longer than ${Math.round(limitMs / 60_000)} minutes`);
    this.name = 'JobTimeoutError';
  }
}

export async function withDeadline<T>(
  limitMs: number,
  code: string,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new JobTimeoutError(code, limitMs)), limitMs);
  try {
    return await work(ctrl.signal);
  } catch (err) {
    // Whatever the work threw once the time was up (an aborted call, a stopped stage), the cause is the time limit.
    if (ctrl.signal.aborted) throw ctrl.signal.reason as JobTimeoutError;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Stops a stage when its job's time is up (call between steps). */
export function checkDeadline(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}

/**
 * For optional steps that carry on when they fail (a query rewrite, an extra check): the job's time limit must still
 * stop the work, and the skip must be visible. Rethrows a timeout; otherwise raises a named warning and returns.
 */
export function skipOptionalStep(step: string, err: unknown): void {
  if (err instanceof JobTimeoutError) throw err;
  process.emitWarning(`${step} was skipped: ${err instanceof Error ? err.message : String(err)}`, {
    code: 'NYAAI_OPTIONAL_STEP_SKIPPED',
  });
}
