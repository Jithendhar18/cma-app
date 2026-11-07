-- M1: baseline hardening. Default deny for the public schema.
--
-- Supabase grants full privileges on every new public table, function and sequence to the `anon`
-- and `authenticated` roles by default. Row level security still protects rows, but we also remove
-- the privileges we do not need, so that a table created without a policy is unreachable instead of
-- relying on RLS alone. Each table's own migration then grants exactly what it needs.
--
-- This migration contains no tables and no data.

-- Objects created from now on (migrations run as `postgres`) start with no access for the API roles.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
-- Postgres grants EXECUTE on every new function to PUBLIC (everyone) through a GLOBAL default.
-- `IN SCHEMA public` cannot remove a global default, so this one is deliberately schema-less. It
-- applies to functions created by the role running migrations (postgres), in every schema.
alter default privileges revoke execute on functions from public;

-- Anything that already exists in public gets the same treatment (nothing, at this point).
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

-- Shared trigger function: keeps updated_at current. Clients use it to refresh caches and to pull
-- only changed rows.
--
-- clock_timestamp() rather than now(): now() is frozen at the start of the transaction, so a long
-- transaction could stamp a row with a time EARLIER than a client's sync cursor and an incremental
-- pull would never see it. The statement-time clock keeps stamps close to the real write time.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'BEFORE UPDATE trigger: stamps updated_at. Internal; not granted to API roles.';
