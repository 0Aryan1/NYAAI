-- Runs once, as superuser, when the local volume is first created.
-- Roles from LLD §3.7: owner runs migrations; app/worker are bound by every RLS policy; library writes shared rows.
create role nyaai_owner   login password 'nyaai_owner_dev';
create role nyaai_app     login password 'nyaai_app_dev'     nobypassrls;
create role nyaai_worker  login password 'nyaai_worker_dev'  nobypassrls;
create role nyaai_library login password 'nyaai_library_dev' nobypassrls;

alter database nyaai owner to nyaai_owner;
alter schema public owner to nyaai_owner;
grant usage on schema public to nyaai_app, nyaai_worker, nyaai_library;

-- Extensions need superuser on first install; migrations re-declare them idempotently.
create extension if not exists vector;
create extension if not exists pg_trgm;
create extension if not exists citext;

-- Tables created later by nyaai_owner are usable (subject to RLS) by the runtime roles.
alter default privileges for role nyaai_owner in schema public
  grant select, insert, update, delete on tables to nyaai_app, nyaai_worker, nyaai_library;
alter default privileges for role nyaai_owner in schema public
  grant usage, select on sequences to nyaai_app, nyaai_worker, nyaai_library;
alter default privileges for role nyaai_owner in schema public
  grant execute on functions to nyaai_app, nyaai_worker, nyaai_library;
