/**
 * Library editor review of judgments (HLD 5.2 b, f; part of LIB-2, pulled forward from Day 5):
 *  - list judgments with whether their labels are checked and whether they are still provisional;
 *  - open one: every paragraph with its opinion and role; correct a role;
 *  - "Labels checked" sets sources.roles_sampled (C7 then lets high-risk "held" claims rest on it);
 *  - "Approve" turns a live lookup from provisional into live.
 * Each action closes the matching review item. Lectures already built keep their flags until they are rebuilt.
 */
import express from 'express';
import { z } from 'zod';
import { ReviewJudgment, ReviewJudgmentList, SetParagraphLabel } from '@nyaai/shared';
import { AppError } from '../errors.ts';
import { requireRole } from '../middleware/auth.ts';
import { approveSourceChunks, judgmentParagraphs, setParagraphLabel } from '../services/search/index.ts';

const Id = z.uuid();
/** A `date` column as YYYY-MM-DD, read in local time (pg gives local midnight). */
const isoDate = (d: Date | null) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null);
type Status = ReviewJudgment['status'];

export function reviewRouter() {
  const r = express.Router();
  r.use(['/library/judgments', '/library/paragraphs'], requireRole('library_editor'));

  r.get('/library/judgments', async (req, res) => {
    const rows = await req.db!(async (c) =>
      (
        await c.query<{ id: string; title: string; court: string | null; decided_on: Date | null; status: Status; roles_sampled: boolean; paragraphs: number; origin: string; scanned: boolean }>(
          `select s.id, s.title, s.court, s.decided_on, s.status, s.roles_sampled, s.origin, s.scanned,
                  (select count(*)::int from chunks k where k.source_id = s.id and k.kind <> 'headnote') as paragraphs
             from sources s
            where s.type = 'judgment' and s.visibility = 'shared' and s.status <> 'retired'
            order by s.roles_sampled, (s.status = 'provisional') desc, s.title`,
        )
      ).rows,
    );
    res.json(
      ReviewJudgmentList.parse({
        judgments: rows.map((x) => ({ id: x.id, title: x.title, court: x.court, decidedOn: isoDate(x.decided_on), status: x.status, rolesChecked: x.roles_sampled, paragraphs: x.paragraphs, origin: x.origin, scanned: x.scanned })),
      }),
    );
  });

  r.get('/library/judgments/:id', async (req, res) => {
    const id = Id.parse(req.params.id);
    const out = await req.db!(async (c) => {
      const s = (
        await c.query<{
          id: string; title: string; court: string | null; decided_on: Date | null; url: string | null; status: Status; roles_sampled: boolean;
          origin: string; citation: string | null; scanned: boolean; expires_at: Date | null;
        }>(
          "select id, title, court, decided_on, url, status, roles_sampled, origin, citation, scanned, expires_at from sources where id = $1 and type = 'judgment'",
          [id],
        )
      ).rows[0];
      if (!s) return null;
      const copies = (
        await c.query<{ origin: string; url: string | null; citation: string | null; scanned: boolean; agreement: string | null; in_use: boolean }>(
          'select origin, url, citation, scanned, agreement, in_use from source_copies where source_id = $1 order by in_use desc, created_at',
          [id],
        )
      ).rows;
      return { s, copies, paragraphs: await judgmentParagraphs(c, id) };
    });
    if (!out) throw new AppError('NOT_FOUND', 'We could not find that judgment.');
    const { s, copies, paragraphs } = out;
    res.json(
      ReviewJudgment.parse({
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
        copies: copies.map((x) => ({ origin: x.origin, url: x.url, citation: x.citation, scanned: x.scanned, agreement: x.agreement === null ? null : Number(x.agreement), inUse: x.in_use })),
        paragraphs: paragraphs.map((p) => ({ chunkId: p.chunkId, paraNo: p.paraNo, kind: p.kind, opinion: p.opinion, judge: p.judge, role: p.role, text: p.text })),
      }),
    );
  });

  r.patch('/library/paragraphs/:id', async (req, res) => {
    const id = Id.parse(req.params.id);
    const body = SetParagraphLabel.parse(req.body);
    const ok = await req.db!((c) => setParagraphLabel(c, id, body));
    if (!ok) throw new AppError('NOT_FOUND', 'That paragraph cannot be relabelled.');
    res.status(204).end();
  });

  /** She has read the paragraphs and their labels are right (after any corrections). */
  r.post('/library/judgments/:id/roles-checked', async (req, res) => {
    const id = Id.parse(req.params.id);
    const ok = await req.db!(async (c) => {
      const s = await c.query("update sources set roles_sampled = true where id = $1 and type = 'judgment' returning id", [id]);
      if (!s.rowCount) return false;
      await c.query(
        `update review_queue set state = 'resolved', resolved_at = now(), assignee_id = app_user(), resolution = jsonb_build_object('action', 'roles_checked')
          where ref_id = $1 and kind = 'role_sample' and state in ('open', 'in_progress')`,
        [id],
      );
      return true;
    });
    if (!ok) throw new AppError('NOT_FOUND', 'We could not find that judgment.');
    res.status(204).end();
  });

  /** A live lookup (Indian Kanoon) is the right judgment and its text is sound: provisional → live. */
  r.post('/library/judgments/:id/approve', async (req, res) => {
    const id = Id.parse(req.params.id);
    const ok = await req.db!(async (c) => {
      const s = await c.query("update sources set status = 'live' where id = $1 and status = 'provisional' returning id", [id]);
      if (!s.rowCount) return false;
      await approveSourceChunks(c, id);
      await c.query(
        `update review_queue set state = 'resolved', resolved_at = now(), assignee_id = app_user(), resolution = jsonb_build_object('action', 'approved')
          where ref_id = $1 and kind = 'provisional_source' and state in ('open', 'in_progress')`,
        [id],
      );
      return true;
    });
    if (!ok) throw new AppError('NOT_FOUND', 'That judgment is not waiting for approval.');
    res.status(204).end();
  });

  return r;
}
