/**
 * DATA-3: after a course is planned from her syllabus, find the sources of every lecture in the background, so the
 * library is ready before she prepares them (`ingest.syllabus`).
 *
 * For each waiting lecture, in plan order: a library search for "<course>: <lecture title>"; when it comes back
 * thin, the gap is recorded for the library team and the trusted-source lookup runs (India Code for a named Act,
 * Indian Kanoon for judgments). The query is her own syllabus words, never text from a document (LLD §17.6), and no
 * AI model is used: the search skips the query rewrite, and the lookup is given no model (case names stay as Kanoon
 * prints them; new paragraphs are labelled by rule, or "unknown" for the editor). The result is kept on the lecture.
 */
import type pg from 'pg';
import { withTenant, type TenantIdentity } from '@nyaai/db';
import type { UnitSources } from '@nyaai/shared';
import { searchWithLookup, type GapLookup } from '../lookup/index.ts';
import type { SearchDeps } from '../search/index.ts';
import { usageSink, type UsageSink } from '../usage/index.ts';
import type { Voyage } from '../voyage/index.ts';

export interface CourseSourcesDeps {
  worker: pg.Pool;
  voyageFor: (usage: UsageSink) => Voyage;
  lookup: GapLookup | null;
  minScore: number;
  /** Stop starting new lectures after this long; the rest are marked "not checked" (checked when she prepares them). */
  budgetMs: number;
}

export interface CourseSourcesResult {
  checked: number;
  ok: number;
  thin: number;
  notFound: number;
  notChecked: number;
}

export async function findCourseSources(
  courseId: string,
  who: TenantIdentity,
  deps: CourseSourcesDeps,
): Promise<CourseSourcesResult> {
  const tenant = <T>(fn: (c: pg.PoolClient) => Promise<T>) => withTenant(deps.worker, who, fn);
  const course = await tenant(
    async (c) => (await c.query<{ name: string }>('select name from courses where id = $1', [courseId])).rows[0],
  );
  const out: CourseSourcesResult = { checked: 0, ok: 0, thin: 0, notFound: 0, notChecked: 0 };
  if (!course) return out;
  const units = await tenant(
    async (c) =>
      (
        await c.query<{ id: string; title: string }>(
          "select id, title from course_units where course_id = $1 and sources->>'state' = 'waiting' order by position",
          [courseId],
        )
      ).rows,
  );
  const searchDeps = (c: pg.PoolClient): SearchDeps => {
    const usage = usageSink(c, { collegeId: who.collegeId, ownerId: who.userId });
    return { voyage: deps.voyageFor(usage), gateway: null, usage, minScore: deps.minScore };
  };
  const save = (id: string, s: UnitSources) =>
    tenant((c) => c.query('update course_units set sources = $2 where id = $1', [id, s]));
  const started = Date.now();

  for (const u of units) {
    if (Date.now() - started > deps.budgetMs) {
      await save(u.id, { state: 'not_checked', found: null, loaded: null, checkedAt: null });
      out.notChecked++;
      continue;
    }
    const r = await searchWithLookup(
      tenant,
      { query: `${course.name}: ${u.title}`.slice(0, 500), purpose: 'lecture_part', noExpand: true, maxSources: 6 },
      searchDeps,
      deps.lookup,
    );
    const state = r.outcome;
    await save(u.id, {
      state,
      found: r.sources.length,
      loaded: r.gap?.lookup?.loadedSourceIds.length ?? 0,
      checkedAt: new Date().toISOString(),
    });
    out.checked++;
    if (state === 'ok') out.ok++;
    else if (state === 'thin') out.thin++;
    else out.notFound++;
  }
  return out;
}
