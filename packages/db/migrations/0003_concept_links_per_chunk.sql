-- 0003: a concept can have several key sections in the same Act (frustration: ICA ss. 56, 32, 65).
-- LLD §3.4 keyed concept_links on (concept_id, source_id, kind), which allows only one per Act.
-- The chunk now takes part in uniqueness; a link without a chunk (a whole case) still counts once.
alter table concept_links drop constraint concept_links_pkey;
create unique index concept_links_unique
  on concept_links (concept_id, source_id, kind, coalesce(chunk_id, '00000000-0000-0000-0000-000000000000'::uuid));
