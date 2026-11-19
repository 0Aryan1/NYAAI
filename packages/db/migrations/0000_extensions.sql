-- 0000: extensions (LLD §3.1). Installed by the superuser init script locally; idempotent here for Neon/RDS.
create extension if not exists vector;   -- pgvector >= 0.8.0 (iterative scans)
create extension if not exists pg_trgm;  -- fuzzy case-name and topic matching
create extension if not exists citext;
