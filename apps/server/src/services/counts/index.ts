/**
 * The lecture's header counts, defined once: points to verify (yellow) and lines resting on a case whose status no
 * expert has confirmed (grey). Counted per LINE (a line with several open claims is one point), over the lines still
 * in the lecture, with each case's status read live:
 *  - yellow: any claim on the line is open, or rests on a case an expert marked overruled or reversed;
 *  - grey: not yellow, and a claim rests on a case whose status is still "not verified".
 * The Studio reads them live; `storeLineCounts` keeps the copy on the lecture row (used by lists) the same.
 */
import type pg from 'pg';

export interface LineCounts {
  yellow: number;
  grey: number;
}

const COUNT_SQL = `
  with lines as (
    select ci.slide_id, ci.line_key,
           bool_or(ci.check_status = 'open' or cs.status in ('overruled', 'reversed')) as yellow,
           bool_or(ci.flag_kind = 'grey' and coalesce(cs.status, 'not_verified') = 'not_verified') as grey
      from citations ci left join case_status_v cs on cs.source_id = ci.source_id
     where ci.lecture_id = $1 and ci.check_status <> 'removed'
     group by ci.slide_id, ci.line_key)
  select (select count(*)::int from lines where yellow) as yellow,
         (select count(*)::int from lines where grey and not yellow) as grey`;

export async function lineCounts(c: pg.PoolClient, lectureId: string): Promise<LineCounts> {
  const r = (await c.query<LineCounts>(COUNT_SQL, [lectureId])).rows[0];
  return { yellow: r?.yellow ?? 0, grey: r?.grey ?? 0 };
}

/** Counts the lines and stores them on the lecture (yellow_open, grey_open). */
export async function storeLineCounts(c: pg.PoolClient, lectureId: string): Promise<LineCounts> {
  const counts = await lineCounts(c, lectureId);
  await c.query('update lectures set yellow_open = $2, grey_open = $3 where id = $1', [
    lectureId,
    counts.yellow,
    counts.grey,
  ]);
  return counts;
}
