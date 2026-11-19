-- Development seed: two colleges and four dev users. Never run outside NODE_ENV=development
-- (scripts/seed.ts refuses). Idempotent: safe to run again.
insert into colleges (id, name, slug, is_global) values
  ('00000000-0000-4000-8000-000000000001', 'Shared library', 'global', true),
  ('00000000-0000-4000-8000-000000000002', 'Chanakya National Law University', 'cnlu', false)
on conflict (id) do nothing;

insert into users (id, college_id, email, name, role) values
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000002', 'teacher.a@cnlu.ac.in', 'Teacher A (dev)', 'teacher'),
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-000000000002', 'teacher.b@cnlu.ac.in', 'Teacher B (dev)', 'teacher'),
  ('00000000-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-000000000002', 'admin@cnlu.ac.in', 'Admin (dev)', 'admin'),
  ('00000000-0000-4000-8000-00000000000d', '00000000-0000-4000-8000-000000000002', 'editor@cnlu.ac.in', 'Library editor (dev)', 'library_editor')
on conflict (id) do nothing;

insert into invite_allowlist (college_id, email, role, accepted_at)
select college_id, email, role, now() from users where email like '%@cnlu.ac.in'
on conflict (college_id, email) do nothing;

insert into teacher_profiles (owner_id, college_id)
select id, college_id from users where email like '%@cnlu.ac.in'
on conflict (owner_id) do nothing;
