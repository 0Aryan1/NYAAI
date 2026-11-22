-- 0007: official judgment copies (BRD DATA-7, HLD D25: leading cases from official court websites first, kept
-- permanently; Indian Kanoon only for gaps). Until now every judgment came from Indian Kanoon and expired.
--
-- source_copies: every copy of a source the library holds, where it came from, and how it compares with the text in
-- use. When an official copy is clean (typeset), its text replaces the Kanoon text in place (same source row, same
-- chunk ids where the paragraph is the same) and the source no longer expires. When the official copy is a scan of
-- the printed report (e-SCR before 2018), its machine-read text has reading errors, so the cleaner text stays in use
-- and the official copy is kept beside it with how far the two agree, for the editor.
--
-- sources.scanned: the text in use was machine-read from a scan (an official scan is the only copy there is).
-- Lectures label such a source, and the editor checks quotes against the PDF.

alter table sources add column scanned boolean not null default false;

create table source_copies (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null,
  source_id uuid not null references sources(id) on delete cascade,
  origin source_origin not null,
  url text,
  storage_key text not null,
  content_hash text not null,
  citation text,                      -- the official report's citations, e.g. "[2014] 13 S.C.R. 895; 2014 INSC 809"
  scanned boolean not null,
  agreement numeric(4,3),             -- share of this copy's word runs found in the text in use (null: not compared)
  in_use boolean not null,            -- this copy's text is the library text
  created_at timestamptz not null default now(),
  unique (source_id, content_hash)
);
create index source_copies_source on source_copies (source_id);

alter table source_copies enable row level security;
alter table source_copies force row level security;

-- Library data: everyone signed in reads; only the ingestion role writes.
create policy copies_read on source_copies for select to nyaai_app, nyaai_worker using (app_user() is not null);
create policy copies_library on source_copies for all to nyaai_library using (true) with check (true);
