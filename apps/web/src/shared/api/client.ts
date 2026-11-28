/**
 * The web app's API client: one module per area (account, lectures, library, research, explore, courses, notes),
 * assembled here so screens import one `api` and one `queryKeys`. Requests, errors and CSRF live in ./http.
 *
 * Query keys: every query and every invalidation uses a key from here (never a literal array). Keys that cover a
 * whole area end in `All` (`lectureAll(id)`, `reviewAll`, `exploreAll`); the others are exact.
 */
import { accountApi, accountKeys } from './account';
import { coursesApi, courseKeys } from './courses';
import { exploreApi, exploreKeys } from './explore';
import { lecturesApi, lectureKeys } from './lectures';
import { libraryApi, libraryKeys } from './library';
import { notesApi, notesKeys } from './notes';
import { researchApi, researchKeys } from './research';

export { ApiRequestError } from './http';

/** Typed client: every answer is checked with the shared Zod schemas, so web and server cannot drift. */
export const api = {
  ...accountApi,
  ...lecturesApi,
  ...libraryApi,
  ...researchApi,
  ...exploreApi,
  ...coursesApi,
  ...notesApi,
};

export const queryKeys = {
  ...accountKeys,
  ...lectureKeys,
  ...libraryKeys,
  ...researchKeys,
  ...exploreKeys,
  ...courseKeys,
  ...notesKeys,
};
