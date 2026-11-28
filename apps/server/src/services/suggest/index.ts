/**
 * Suggestions as she types a topic (HOME-2): topics from the expert's list, sections and Articles, cases and her own
 * course lectures. No AI: name matches and trigram similarity only, so it answers in a few milliseconds.
 */
import type pg from 'pg';
import type { Suggestion } from '@nyaai/shared';

/** At most 8 suggestions: up to 4 topics, 4 sections or Articles, 3 cases and 3 of her lectures. */
export async function suggest(c: pg.PoolClient, q: string): Promise<Suggestion[]> {
  const like = `${q.replace(/[%_\\]/g, '\\$&')}%`;
  const concepts = await c.query<{ name: string; subject: string }>(
    `select name, subject from legal_concepts
      where name ilike $1 or name % $2 or exists (select 1 from unnest(aliases) a where a ilike $1 or a % $2)
      order by greatest(similarity(name, $2), (select max(similarity(a, $2)) from unnest(aliases) a)) desc nulls last limit 4`,
    [like, q],
  );
  const sections = await c.query<{
    header: string;
    act_name: string | null;
    section: string | null;
    article: string | null;
  }>(
    `select header, act_name, section, article from chunks
      where visibility = 'shared' and parent_id is null and source_type in ('act', 'constitution') and status in ('live', 'provisional')
        and law_status is distinct from 'repealed'
        and (header ilike '%' || $1 || '%' or section = upper($1) or article = upper($1))
      order by (section = upper($1) or article = upper($1)) desc, similarity(header, $1) desc limit 4`,
    [q],
  );
  const cases = await c.query<{ title: string; court: string | null; decided_on: Date | null }>(
    `select title, court, decided_on from sources
      where type = 'judgment' and status in ('live', 'provisional') and (title ilike '%' || $1 || '%' or title % $1)
      order by similarity(title, $1) desc limit 3`,
    [q],
  );
  const units = await c.query<{ title: string; course: string }>(
    `select u.title, co.name as course from course_units u join courses co on co.id = u.course_id
      where u.title ilike '%' || $1 || '%' order by u.position limit 3`,
    [q],
  );
  const rows = { concepts: concepts.rows, sections: sections.rows, cases: cases.rows, units: units.rows };
  return [
    ...rows.concepts.map((x) => ({ kind: 'concept' as const, label: x.name, detail: x.subject, value: x.name })),
    ...rows.sections.map((x) => {
      const short = x.header.split(' › ').pop() ?? x.header;
      return { kind: 'section' as const, label: short, detail: x.act_name ?? null, value: short };
    }),
    ...rows.cases.map((x) => ({
      kind: 'case' as const,
      label: x.title,
      detail: [x.court, x.decided_on?.getFullYear()].filter(Boolean).join(', ') || null,
      value: x.title,
    })),
    ...rows.units.map((x) => ({ kind: 'unit' as const, label: x.title, detail: x.course, value: x.title })),
  ].slice(0, 8);
}
