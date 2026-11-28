/**
 * Queue a job for something already saved (a lecture "building", a research run "planning", a note "queued", an
 * upload "processing"). If the queue refuses (Redis down, a network blip), the saved row would wait for ever for a
 * job that never comes. `enqueueOrUndo` puts the row right instead (marks it failed so she can try again, or removes
 * it) and answers 503 with a plain message. The undo runs in its own transaction, after the save was committed.
 */
import { AppError } from '../errors.ts';

export async function enqueueOrUndo<T>(
  add: () => Promise<T>,
  undo: () => Promise<unknown>,
  message: string,
  log?: { error: (obj: object, msg: string) => void },
): Promise<T> {
  try {
    return await add();
  } catch (err) {
    try {
      await undo();
    } catch (undoErr) {
      log?.error({ err: undoErr }, 'could not put a saved row right after the queue refused its job');
    }
    log?.error({ err }, 'the queue refused a job');
    throw new AppError('SERVICE_UNAVAILABLE', message);
  }
}
