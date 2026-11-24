-- 0013: a teacher's own notes (BRD DATA-5, HLD "Teacher notes and slides"; decision 2026-11-25 in docs/memory.md).
--
-- She uploads a document (Word, PDF or plain text) to her private space. The worker reads it, as her, into a private
-- source of type teacher_note: one chunk per heading block. Nobody else can read it (row security, 0001).
--
-- Option A: a lecture uses only the notes attached to it (lecture_inputs.note_upload_ids). Her other notes are never
-- searched for that lecture: the search filters private sources to the attached ones before searching, and the build
-- drops any private source that is not attached.
--
-- Versions: an upload may replace an older one. When the new one is read, the old one is marked replaced and its
-- text leaves search; a lecture that attached the old one, and is built later, uses the new one.

alter table uploads
  add column title text,
  add column replaces uuid references uploads(id) on delete set null,
  add column replaced_by uuid references uploads(id) on delete set null,
  add column sections int,
  add column error text,
  add constraint uploads_status check (status in ('queued', 'reading', 'ready', 'failed', 'replaced', 'deleted'));

create index uploads_owner on uploads (owner_id, created_at desc);

alter table lecture_inputs add column note_upload_ids uuid[] not null default '{}';
