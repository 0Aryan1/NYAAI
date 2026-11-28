/**
 * Library editor review of judgments (HLD 5.2 a, b, f; LIB-1, LIB-2). Each action closes the matching item in the
 * editor's review queue. Lectures already built keep their flags until rebuilt, except case status, which the Studio
 * reads live.
 *  - roles checked: sets sources.roles_sampled (C7 then lets high-risk "held" claims rest on the judgment);
 *  - approve: a live lookup (e.g. Indian Kanoon) goes from provisional to live;
 *  - same case?: a lookup loaded a judgment that may be one already held (0012). A different case clears the
 *    question; the same case retires the new copy and keeps its link on the case that stays;
 *  - case status: the expert's finding that a case is still good law, doubted, overruled or reversed.
 * Runs as the editor (RLS).
 */
import type pg from 'pg';
import type { CaseStatus, ReviewJudgment, ReviewJudgmentList, SetCaseStatus } from '@nyaai/shared';
import { AppError } from '../../errors.ts';
import { approveSourceChunks, judgmentParagraphs, retireSourceChunks } from './paragraphs.ts';
import { pageOf, pageSql, type Page } from '../../lib/page.ts';

type Status = ReviewJudgment['status'];
type QueueKind = 'role_sample' | 'provisional_source' | 'case_status' | 'library_gap';

/** A `date` column as YYYY-MM-DD, read in local time (pg gives local midnight). */
const isoDate = (d: Date | null) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null;

/**
 * Closes the open review item(s) for `refId` (of one kind, or any kind when null), recording what she did. The
 * editor is recorded as the one who did it, unless `byEditor` is false (a gap closed by the lookup itself).
 */
export async function resolveQueueItem(
  c: pg.PoolClient,
  refId: string,
  kind: QueueKind | null,
  resolution: Record<string, unknown>,
  byEditor = true,
): Promise<void> {
  await c.query(
    `update review_queue
        set state = 'resolved', resolved_at = now(), resolution = $3::jsonb,
            assignee_id = case when $4 then app_user() else assignee_id end
      where ref_id = $1 and ($2::text is null or kind::text = $2) and state in ('open', 'in_progress')`,
    [refId, kind, JSON.stringify(resolution), byEditor],
  );
}

/** Opens a resolved review item again (a gap she reopened). */
export async function reopenQueueItem(c: pg.PoolClient, refId: string, kind: QueueKind): Promise<void> {
  await c.query(
    "update review_queue set state = 'open', resolved_at = null where ref_id = $1 and kind::text = $2 and state = 'resolved'",
    [refId, kind],
  );
}

/** Every shared judgment, in a fixed order (by title): one never jumps down the list once she has worked on it. */
export async function listJudgments(c: pg.PoolClient, page: Page): Promise<ReviewJudgmentList> {
  const tail = pageSql(page, 1);
  const rows = (
    await c.query<{
      id: string;
      title: string;
      court: string | null;
      decided_on: Date | null;
      status: Status;
      roles_sampled: boolean;
      paragraphs: number;
      origin: string;
      scanned: boolean;
      case_status: CaseStatus;
      maybe_same: boolean;
    }>(
      `select s.id, s.title, s.court, s.decided_on, s.status, s.roles_sampled, s.origin, s.scanned, cs.status as case_status,
              s.maybe_same_as is not null as maybe_same,
              (select count(*)::int from chunks k where k.source_id = s.id and k.kind <> 'headnote') as paragraphs
         from sources s left join case_status_v cs on cs.source_id = s.id
        where s.type = 'judgment' and s.visibility = 'shared' and s.status <> 'retired'
        order by s.title, s.id${tail.sql}`,
      tail.params,
    )
  ).rows;
  const { rows: shown, nextCursor } = pageOf(rows, page);
  return {
    nextCursor,
    judgments: shown.map((x) => ({
      id: x.id,
      title: x.title,
      court: x.court,
      decidedOn: isoDate(x.decided_on),
      status: x.status,
      rolesChecked: x.roles_sampled,
      paragraphs: x.paragraphs,
      origin: x.origin,
      scanned: x.scanned,
      caseStatus: x.case_status ?? 'not_verified',
      maybeSame: x.maybe_same,
    })),
  };
}

/** One judgment for review: its copies, the expert's status findings, a same-case question, and every paragraph. */
export async function getJudgment(c: pg.PoolClient, id: string): Promise<ReviewJudgment | null> {
  const s = (
    await c.query<{
      id: string;
      title: string;
      court: string | null;
      decided_on: Date | null;
      url: string | null;
      status: Status;
      roles_sampled: boolean;
      origin: string;
      citation: string | null;
      scanned: boolean;
      expires_at: Date | null;
      same_id: string | null;
      same_title: string | null;
      same_court: string | null;
      same_decided_on: Date | null;
    }>(
      `select s.id, s.title, s.court, s.decided_on, s.url, s.status, s.roles_sampled, s.origin, s.citation, s.scanned, s.expires_at,
              m.id as same_id, m.title as same_title, m.court as same_court, m.decided_on as same_decided_on
         from sources s left join sources m on m.id = s.maybe_same_as and m.status <> 'retired'
        where s.id = $1 and s.type = 'judgment'`,
      [id],
    )
  ).rows[0];
  if (!s) return null;
  const copies = (
    await c.query<{
      origin: string;
      url: string | null;
      citation: string | null;
      scanned: boolean;
      agreement: string | null;
      in_use: boolean;
    }>(
      'select origin, url, citation, scanned, agreement, in_use from source_copies where source_id = $1 order by in_use desc, created_at',
      [id],
    )
  ).rows;
  const history = (
    await c.query<{
      treatment: CaseStatus;
      note: string | null;
      by_case: string | null;
      confirmed_by: string | null;
      confirmed_at: Date;
    }>(
      `select t.treatment::text as treatment, t.note, coalesce(t.citing_case_name, cs.title) as by_case, u.name as confirmed_by, t.confirmed_at
         from case_treatments t left join sources cs on cs.id = t.citing_source_id left join users u on u.id = t.confirmed_by
        where t.cited_source_id = $1 and t.confirmed_at is not null and t.rejected_at is null
        order by t.confirmed_at desc`,
      [id],
    )
  ).rows;
  const paragraphs = await judgmentParagraphs(c, id);
  return {
    id: s.id,
    title: s.title,
    court: s.court,
    decidedOn: isoDate(s.decided_on),
    url: s.url,
    status: s.status,
    rolesChecked: s.roles_sampled,
    origin: s.origin,
    citation: s.citation,
    scanned: s.scanned,
    expiresAt: s.expires_at?.toISOString() ?? null,
    copies: copies.map((x) => ({
      origin: x.origin,
      url: x.url,
      citation: x.citation,
      scanned: x.scanned,
      agreement: x.agreement === null ? null : Number(x.agreement),
      inUse: x.in_use,
    })),
    caseStatus: history[0]?.treatment ?? 'not_verified',
    statusHistory: history.map((h) => ({
      status: h.treatment,
      note: h.note,
      byCase: h.by_case,
      confirmedBy: h.confirmed_by,
      confirmedAt: h.confirmed_at.toISOString(),
    })),
    maybeSameAs: s.same_id
      ? { id: s.same_id, title: s.same_title!, court: s.same_court, decidedOn: isoDate(s.same_decided_on) }
      : null,
    paragraphs: paragraphs.map((p) => ({
      chunkId: p.chunkId,
      paraNo: p.paraNo,
      kind: p.kind,
      opinion: p.opinion,
      judge: p.judge,
      role: p.role,
      text: p.text,
    })),
  };
}

/** She has read the paragraphs and their labels are right (after any corrections). */
export async function markRolesChecked(c: pg.PoolClient, id: string): Promise<void> {
  const s = await c.query("update sources set roles_sampled = true where id = $1 and type = 'judgment' returning id", [
    id,
  ]);
  if (!s.rowCount) throw new AppError('NOT_FOUND', 'We could not find that judgment.');
  await resolveQueueItem(c, id, 'role_sample', { action: 'roles_checked' });
}

/** A live lookup is the right judgment and its text is sound: provisional → live. */
export async function approveJudgment(c: pg.PoolClient, id: string): Promise<void> {
  const open = await c.query(
    "select 1 from sources s join sources m on m.id = s.maybe_same_as and m.status <> 'retired' where s.id = $1",
    [id],
  );
  if (open.rowCount)
    throw new AppError(
      'VALIDATION_FAILED',
      'First say whether this is the same case as the one already in the library.',
    );
  const s = await c.query("update sources set status = 'live' where id = $1 and status = 'provisional' returning id", [
    id,
  ]);
  if (!s.rowCount) throw new AppError('NOT_FOUND', 'That judgment is not waiting for approval.');
  await approveSourceChunks(c, id);
  await resolveQueueItem(c, id, 'provisional_source', { action: 'approved' });
}

/**
 * "Is this the same case as …?" A different case: the question is closed. The same case: this copy leaves the
 * library (its paragraphs leave search) and its link is kept on the case that stays, so no lookup loads it again.
 */
export async function answerSameCase(c: pg.PoolClient, id: string, same: boolean): Promise<void> {
  const s = (
    await c.query<{ keep: string }>(
      "select maybe_same_as as keep from sources where id = $1 and type = 'judgment' and maybe_same_as is not null",
      [id],
    )
  ).rows[0];
  if (!s) throw new AppError('NOT_FOUND', 'That judgment has no open same-case question.');
  if (!same) {
    await c.query('update sources set maybe_same_as = null where id = $1', [id]);
    return;
  }
  await c.query(
    `insert into source_copies (college_id, source_id, origin, url, storage_key, content_hash, citation, scanned, agreement, in_use)
     select global_college(), $2, origin, url, storage_key, content_hash, citation, scanned, null, false
       from sources where id = $1 and storage_key is not null
     on conflict (source_id, content_hash) do nothing`,
    [id, s.keep],
  );
  await c.query("update sources set status = 'retired', maybe_same_as = null where id = $1", [id]);
  await retireSourceChunks(c, id);
  await resolveQueueItem(c, id, null, { action: 'same_case', kept: s.keep });
}

/**
 * The expert's finding on a case's current status (HLD 5.2 a: who, when and on what basis). The newest confirmed
 * finding is what every lecture shows, at once: lectures read case status live.
 */
export async function setCaseStatus(c: pg.PoolClient, id: string, body: SetCaseStatus): Promise<void> {
  const s = await c.query("select 1 from sources where id = $1 and type = 'judgment'", [id]);
  if (!s.rowCount) throw new AppError('NOT_FOUND', 'We could not find that judgment.');
  await c.query(
    `insert into case_treatments (cited_source_id, citing_case_name, treatment, suggested_by, confirmed_by, confirmed_at, note)
     values ($1, $2, $3, 'editor', app_user(), now(), $4)`,
    [id, body.status === 'good_law' ? null : body.byCase, body.status, body.note],
  );
  await resolveQueueItem(c, id, 'case_status', { action: 'case_status', status: body.status });
}
