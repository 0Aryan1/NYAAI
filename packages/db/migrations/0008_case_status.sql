-- 0008: the library editor confirms a case's current status directly (HLD 5.2 a "before launch", D28; LIB-2).
-- Until the suggestion job (status.suggest, week 2) proposes treatments from citing judgments, the expert records
-- what she found: still good law, doubted, overruled or reversed, with her note and, for an adverse status, the
-- later judgment. Reasons in docs/memory.md (2026-11-22).

-- "Still good law" is the expert's finding that no later judgment overrules or reverses the case; it has no citing
-- judgment of its own.
alter type treatment add value if not exists 'good_law';

alter table case_treatments
  alter column citing_source_id drop not null,
  -- The later judgment by name when it is not in the library ("Overruled by X v. Y (2019) 5 SCC 1").
  add column citing_case_name text,
  add constraint case_treatments_citing_known check (treatment::text = 'good_law' or citing_source_id is not null or citing_case_name is not null);

create index if not exists case_treatments_cited on case_treatments (cited_source_id, confirmed_at desc);
