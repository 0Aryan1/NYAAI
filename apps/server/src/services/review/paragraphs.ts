/**
 * A judgment's paragraphs for the library editor's review (HLD 5.2 b, f): each with its opinion and role; her
 * correction of a role; approving a live lookup's text; retiring a second copy. Runs as the editor (nyaai_app);
 * migration 0006 lets her change only para_role, opinion and status on shared rows.
 */
import type pg from 'pg';

export interface ReviewParagraph {
  chunkId: string;
  seq: number;
  paraNo: string | null;
  kind: string;
  opinion: string | null;
  judge: string | null;
  role: string | null;
  text: string;
}

export async function judgmentParagraphs(db: pg.PoolClient, sourceId: string): Promise<ReviewParagraph[]> {
  const r = await db.query<{
    id: string;
    seq: number;
    para_no: string | null;
    kind: string;
    opinion: string | null;
    judge: string | null;
    para_role: string | null;
    text: string;
  }>(
    "select id, seq, para_no, kind, opinion, judge, para_role, text from chunks where source_id = $1 and source_type = 'judgment' order by seq",
    [sourceId],
  );
  return r.rows.map((x) => ({
    chunkId: x.id,
    seq: x.seq,
    paraNo: x.para_no,
    kind: x.kind,
    opinion: x.opinion,
    judge: x.judge,
    role: x.para_role,
    text: x.text,
  }));
}

/** The editor's correction of one paragraph's role (and opinion, when the split was wrong). */
export async function setParagraphLabel(
  db: pg.PoolClient,
  chunkId: string,
  label: { role: string; opinion?: string },
): Promise<boolean> {
  const r = await db.query(
    "update chunks set para_role = $2::para_role, opinion = coalesce($3::opinion_type, opinion) where id = $1 and source_type = 'judgment' and kind <> 'headnote'",
    [chunkId, label.role, label.opinion ?? null],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Approving a live lookup: the source and its chunks go from provisional to live (rows needing review stay). */
export async function approveSourceChunks(db: pg.PoolClient, sourceId: string): Promise<void> {
  await db.query("update chunks set status = 'live' where source_id = $1 and status = 'provisional'", [sourceId]);
}

/** A source taken out of the library (a second copy of a case it holds): its chunks leave search. */
export async function retireSourceChunks(db: pg.PoolClient, sourceId: string): Promise<void> {
  await db.query("update chunks set status = 'retired' where source_id = $1 and status <> 'retired'", [sourceId]);
}
