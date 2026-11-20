-- 0002: who may record AI and search costs in `usage` (LLD §17.1 cost logging).
-- 0001 let workers write usage for the teacher they act for. Two more writers need it:
--  * nyaai_library: ingestion of shared library sources (embeddings, labelling) is billed to the GLOBAL college;
--  * nyaai_app: a search run inside a teacher's request (query embedding, rerank, query rewrite) is billed to her.
create policy usage_library_insert on usage for insert to nyaai_library
  with check (college_id = global_college() and owner_id is null);
create policy usage_app_insert on usage for insert to nyaai_app
  with check (college_id = app_college() and (owner_id is null or owner_id = app_user()));

-- The shared library belongs to the GLOBAL college, so its review items ("sample this source", provisional
-- sources) are created there by ingestion (nyaai_library) and worked by library editors of any college.
create policy queue_library_insert on review_queue for insert to nyaai_library
  with check (college_id = global_college());
create policy queue_library_read on review_queue for select to nyaai_library
  using (college_id = global_college());
drop policy editor_queue on review_queue;
create policy editor_queue on review_queue for all to nyaai_app
  using ((college_id = app_college() or college_id = global_college()) and app_role() = 'library_editor')
  with check ((college_id = app_college() or college_id = global_college()) and app_role() = 'library_editor');
