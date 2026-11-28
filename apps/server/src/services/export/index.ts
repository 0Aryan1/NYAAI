/**
 * Building a lecture's .pptx from what is saved and checked (LLD §10: never from the browser, so the file is exactly
 * what was checked). Runs in her transaction (RLS).
 */
import type pg from 'pg';
import type { CoverageChangedItem } from '@nyaai/shared';
import { AppError } from '../../errors.ts';
import { refreshCounts, saveSlideEdit } from '../edit/index.ts';
import { loadStudioSlides } from '../studio/index.ts';
import { deckFileName, planDeck, type CitationDetail } from './deck.ts';
import { renderPptx } from './pptx.ts';

export async function exportPptx(
  c: pg.PoolClient,
  who: { userId: string; collegeId: string },
  lectureId: string,
  opts: { mode: 'with_flags' | 'remove_unverified'; acknowledgeOpen: boolean; today: string },
): Promise<
  { file: Buffer; fileName: string; removed: number } | { coverageChanged: CoverageChangedItem[]; removed: number }
> {
  const l = (
    await c.query<{
      topic: string;
      status: string;
      length_min: number;
      course_name: string | null;
      position: number | null;
    }>(
      `select l.topic, l.status, l.length_min, c.name as course_name, u.position
         from lectures l left join courses c on c.id = l.course_id left join course_units u on u.id = l.unit_id where l.id = $1`,
      [lectureId],
    )
  ).rows[0];
  if (!l) throw new AppError('NOT_FOUND', 'We could not find that lecture.');
  if (l.status !== 'ready' && l.status !== 'taught')
    throw new AppError('VALIDATION_FAILED', 'The lecture is still being prepared.');

  let slides = await loadStudioSlides(c, lectureId);
  const open = slides.some((s) => [...s.lines, ...s.notes].some((x) => x.flag === 'yellow'));
  let removed = 0;
  if (opts.mode === 'with_flags' && open && !opts.acknowledgeOpen) {
    throw new AppError(
      'VALIDATION_FAILED',
      'This lecture has points to verify. Confirm you have seen them, or remove the unverified lines.',
    );
  }
  if (opts.mode === 'remove_unverified' && open) {
    // PPT-4: every unverified line leaves the lecture itself (a new version of each slide), not just the file.
    for (const s of slides) {
      const keep = (list: typeof s.lines) =>
        list.filter((x) => x.flag !== 'yellow').map((x) => ({ lineKey: x.lineKey, text: x.text, kind: x.kind }));
      const drop = [...s.lines, ...s.notes].filter((x) => x.flag === 'yellow').length;
      if (!drop) continue;
      removed += drop;
      await saveSlideEdit(
        c,
        who,
        s.id,
        { version: s.version, title: s.title, lines: keep(s.lines), notes: keep(s.notes) },
        'remove_unverified',
      );
    }
    // LLD §8.5 step 6: when the removal leaves items uncovered, she sees them before any file is made. The removal
    // itself is kept (the caller commits, then answers 409 COVERAGE_CHANGED); the next Download builds the file.
    const changed = await refreshCounts(c, lectureId);
    if (changed.length) return { coverageChanged: changed, removed };
    slides = await loadStudioSlides(c, lectureId);
  }

  const ids = slides.flatMap((s) => [...s.lines, ...s.notes].flatMap((x) => x.sources.map((y) => y.citationId)));
  const details = new Map(
    (
      await c.query<{
        id: string;
        source_label: string | null;
        title: string | null;
        span_text: string;
        case_status: string | null;
      }>(
        `select ci.id, ci.source_label, s.title, ci.span_text, cs.status as case_status
           from citations ci left join sources s on s.id = ci.source_id left join case_status_v cs on cs.source_id = ci.source_id
          where ci.id = any($1::uuid[])`,
        [ids],
      )
    ).rows.map((r): [string, CitationDetail] => [
      r.id,
      { citationId: r.id, label: r.source_label ?? '', title: r.title, span: r.span_text, caseStatus: r.case_status },
    ]),
  );
  const notCovered = (
    await c.query<{ section_key: string; item_label: string }>(
      "select section_key, item_label from coverage_items where lecture_id = $1 and state = 'missing' order by section_key",
      [lectureId],
    )
  ).rows.map((r) =>
    r.section_key === 'Left out of this lecture'
      ? `${r.item_label} (left out of this lecture)`
      : `${r.item_label} (${r.section_key.replace(/^.*:s/, 's. ')})`,
  );

  const deck = planDeck(slides, details, { withFlags: true, notCovered });
  const subtitle = [
    l.course_name && l.position ? `${l.course_name} · L${String(l.position).padStart(2, '0')}` : l.course_name,
    `${l.length_min} minutes`,
  ]
    .filter(Boolean)
    .join(' · ');
  const file = await renderPptx(deck, { topic: l.topic, subtitle });
  await c.query(
    "insert into edit_events (college_id, owner_id, lecture_id, kind, after) values ($1, $2, $3, 'download', $4)",
    [who.collegeId, who.userId, lectureId, { mode: opts.mode, removed, open: deck.verify.length }],
  );
  return { file, fileName: deckFileName(l.topic, l.position, opts.today), removed };
}
