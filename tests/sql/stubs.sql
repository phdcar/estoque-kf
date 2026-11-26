-- Imitação mínima do que o Supabase já tem pronto (só para testar localmente)
create role anon nologin;
create role service_role nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id serial primary key, bucket_id text, name text);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select, insert, update on storage.objects to authenticated;
grant usage on sequence storage.objects_id_seq to authenticated;
create publication supabase_realtime;
insert into auth.users values
  ('00000000-0000-0000-0000-00000000000a', 'dono@x'),
  ('00000000-0000-0000-0000-00000000000b', 'func@x'),
  ('00000000-0000-0000-0000-00000000000c', 'intruso@x');
