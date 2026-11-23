/**
 * The Studio's view of a lecture (LLD §4.3, §11.4): slides with every line's status, flag and source chips, built
 * from the stored Tiptap-shaped documents and the lecture's citations. Case status is read live (C8).
 */
import type pg from 'pg';
import type { SlideLine, StudioSlide } from '@nyaai/shared';

export interface LineNode {
  attrs?: { lineKey?: string; kind?: SlideLine['kind']; yourExample?: boolean; edited?: boolean };
  content?: { text?: string }[];
}
export interface CitationRow {
  id: string;
  slide_id: string;
  line_key: string;
  tag: string | null;
  source_label: string | null;
  check_status: SlideLine['status'];
  flag_kind: 'yellow' | 'grey' | 'coverage' | null;
  flag_reason: string | null;
  risk: 'normal' | 'high';
  source_status: string | null;
  case_status: string | null;
}

/**
 * One line's status from its claims (LLD §8.4): any open claim → yellow; else any grey → grey; else supported.
 * Case status is read live (C8): a case the expert has since confirmed is no longer grey, and one confirmed overruled
 * or reversed turns the line yellow, in lectures built before her finding too.
 */
export function lineFrom(node: LineNode, cits: CitationRow[]): SlideLine {
  const text = (node.content ?? []).map((t) => t.text ?? '').join('');
  const adverse = cits.find((c) => c.case_status === 'overruled' || c.case_status === 'reversed');
  const open = cits.find((c) => c.check_status === 'open') ?? (adverse ? { ...adverse, flag_reason: `This case was ${adverse.case_status}` } : undefined);
  const grey = cits.find((c) => c.flag_kind === 'grey' && (c.case_status ?? 'not_verified') === 'not_verified');
  const verified = cits.length > 0 && cits.every((c) => c.check_status === 'verified_by_you');
  const status: SlideLine['status'] = open ? 'open' : verified ? 'verified_by_you' : !cits.length && node.attrs?.yourExample ? 'your_example' : 'supported';
  return {
    lineKey: node.attrs?.lineKey ?? '',
    text,
    kind: node.attrs?.kind ?? 'teaching',
    status,
    flag: open ? 'yellow' : grey ? 'grey' : null,
    flagReason: open?.flag_reason ?? grey?.flag_reason ?? null,
    sources: cits
      .filter((c) => c.tag)
      .map((c) => ({ tag: c.tag!, citationId: c.id, label: c.source_label ?? c.tag!, provisional: c.source_status === 'provisional', caseStatus: c.case_status })),
    risk: cits.some((c) => c.risk === 'high') ? 'high' : 'normal',
    edited: node.attrs?.edited === true,
  };
}


/** Active citations only: a removed line's citations are kept for restore but never shown. */
export async function loadStudioSlides(c: pg.PoolClient, lectureId: string, slideId?: string): Promise<StudioSlide[]> {
  const slides = (
    await c.query<{ id: string; position: number; part_index: number; layout: string; title: string; body: { content?: LineNode[] }; notes: { content?: LineNode[] }; current_version: number }>(
      `select id, position, part_index, layout, title, body, notes, current_version from slides where lecture_id = $1 and ($2::uuid is null or id = $2) order by position`,
      [lectureId, slideId ?? null],
    )
  ).rows;
  const cits = (
    await c.query<CitationRow>(
      `select c.id, c.slide_id, c.line_key, c.tag, c.source_label, c.check_status, c.flag_kind, c.flag_reason, c.risk,
              s.status::text as source_status, cs.status as case_status
         from citations c left join sources s on s.id = c.source_id left join case_status_v cs on cs.source_id = c.source_id
        where c.lecture_id = $1 and ($2::uuid is null or c.slide_id = $2) and c.check_status <> 'removed' order by c.created_at`,
      [lectureId, slideId ?? null],
    )
  ).rows;
  const byLine = new Map<string, CitationRow[]>();
  for (const x of cits) byLine.set(`${x.slide_id}|${x.line_key}`, [...(byLine.get(`${x.slide_id}|${x.line_key}`) ?? []), x]);
  return slides.map((s) => ({
    id: s.id,
    position: s.position,
    partIndex: s.part_index,
    layout: s.layout,
    title: s.title,
    version: s.current_version,
    lines: (s.body.content ?? []).map((n) => lineFrom(n, byLine.get(`${s.id}|${n.attrs?.lineKey}`) ?? [])),
    notes: (s.notes.content ?? []).map((n) => lineFrom(n, byLine.get(`${s.id}|${n.attrs?.lineKey}`) ?? [])),
  }));
}
