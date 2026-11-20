-- 0006: the library editor checks judgments (HLD 5.2 b, f): corrects paragraph roles, marks a judgment's labels as
-- checked (sources.roles_sampled), and approves a live lookup (provisional → live). Until now only the ingestion role
-- could write shared chunks. The editor gets exactly three columns, through the API, and only on shared rows.

revoke update on chunks from nyaai_app;
grant update (para_role, opinion, status) on chunks to nyaai_app;

create policy chunks_editor_review on chunks for update to nyaai_app
  using (visibility = 'shared' and app_role() = 'library_editor')
  with check (visibility = 'shared' and app_role() = 'library_editor');
-- An UPDATE must also see the rows it changes; chunks_read already lets every signed-in user read shared rows.
