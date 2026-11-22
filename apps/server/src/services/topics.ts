/**
 * Topic → concept (HOME-9): exact name or alias, or a close trigram match. When the matches span more than one
 * subject the teacher picks (409 TOPIC_AMBIGUOUS with the choices). Used by /topics/resolve and by Prepare.
 */
import type pg from 'pg';
import type { ResolveChoice } from '@nyaai/shared';
import { AppError } from '../errors.ts';

export async function resolveConcept(c: pg.PoolClient, topic: string, choice?: string): Promise<string | null> {
  const all = (
    await c.query<{ id: string; name: string; subject: string; exact: boolean; score: number }>(
      `select id, name, subject,
              lower(name) = lower($1) or exists (select 1 from unnest(aliases) a where lower(a) = lower($1)) as exact,
              greatest(similarity(name, $1), coalesce((select max(similarity(a, $1)) from unnest(aliases) a), 0)) as score
         from legal_concepts
        where lower(name) = lower($1) or exists (select 1 from unnest(aliases) a where lower(a) = lower($1))
           or name % $1 or exists (select 1 from unnest(aliases) a where a % $1 and similarity(a, $1) >= 0.6)
        order by exact desc, score desc, name`,
      [topic],
    )
  ).rows;
  if (choice) {
    if (!all.some((m) => m.id === choice)) throw new AppError('VALIDATION_FAILED', 'That choice does not match this topic.');
    return choice;
  }
  // An exact name or alias wins outright ("Seat of arbitration" is not "Arbitration agreement", however alike the
  // words); otherwise the near matches, best first.
  const matches = all.some((m) => m.exact) ? all.filter((m) => m.exact) : all;
  if (new Set(matches.map((m) => m.subject)).size > 1) {
    const choices: ResolveChoice[] = matches.map((m) => ({ conceptId: m.id, name: m.name, subject: m.subject }));
    throw new AppError('TOPIC_AMBIGUOUS', 'This topic could mean more than one thing. Which one do you mean?', { choices });
  }
  return matches[0]?.id ?? null;
}
