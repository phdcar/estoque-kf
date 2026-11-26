-- Imitação do pg_net e do Vault do Supabase (só para teste local)
create schema if not exists net;
create table net.chamadas (id bigserial primary key, url text, headers jsonb, body jsonb);
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language sql as $$ insert into net.chamadas (url, headers, body) values (url, headers, body) returning id $$;
create schema if not exists vault;
create table vault.decrypted_secrets (name text, decrypted_secret text);
