-- =====================================================================
-- Estoque Clínica KF: banco de dados no Supabase
-- Como usar: Supabase → SQL Editor → New query → cole TUDO → Run.
-- Pode rodar de novo sem problema (não apaga dados).
-- =====================================================================

-- ---------- tabelas ----------
create table if not exists public.membros (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  nome      text not null check (length(trim(nome)) > 0),
  papel     text not null check (papel in ('dono', 'funcionario')),
  criado_em timestamptz not null default now()
);

create table if not exists public.config (
  id             int primary key default 1 check (id = 1),
  inicio         date not null default current_date,      -- primeiro dia de conferência
  prazo          text not null default '18:00' check (prazo ~ '^\d{2}:\d{2}$'),
  codigo_convite text not null default upper(substr(md5(random()::text), 1, 6)),
  atualizado_em  timestamptz not null default now(),
  servidor_em    timestamptz not null default now()
);
insert into public.config (id) values (1) on conflict (id) do nothing;

create table if not exists public.produtos (
  id             uuid primary key,
  nome           text not null check (length(trim(nome)) > 0),
  quantidade     int  not null check (quantidade >= 0),
  minimo         int  not null check (minimo >= 0),
  foto_chave     text,                    -- muda a cada foto nova
  criado_em      timestamptz not null,
  criado_por     text,
  atualizado_em  timestamptz not null,    -- hora do celular que alterou (vence o mais recente)
  atualizado_por text,
  excluido       boolean not null default false,
  servidor_em    timestamptz not null default now()  -- hora do servidor (usada para baixar novidades)
);
create index if not exists produtos_servidor_em on public.produtos (servidor_em);
-- versão 0.3: fornecedor e categoria (o app exige os dois ao salvar)
alter table public.produtos add column if not exists fornecedor text;
alter table public.produtos add column if not exists categoria  text;
-- versão 0.4: validade (data do lote na prateleira) ou ND = produto sem validade
alter table public.produtos add column if not exists validade     date;
alter table public.produtos add column if not exists sem_validade boolean not null default false;
alter table public.produtos add column if not exists ideal        int check (ideal >= 0);   -- estoque ideal (compra sugerida)

create table if not exists public.conferencias (
  id          uuid primary key,
  dia         date not null,
  feita_em    timestamptz not null,
  por_nome    text not null,
  por_papel   text not null,
  por_user    uuid default auth.uid() references auth.users(id) on delete set null,
  itens       jsonb not null,
  servidor_em timestamptz not null default now()
);
create index if not exists conferencias_servidor_em on public.conferencias (servidor_em);

-- ---------- gatilhos ----------
create or replace function public.kf_marcar_servidor() returns trigger
language plpgsql as $$
begin
  new.servidor_em := clock_timestamp();
  return new;
end $$;

-- produto: se chegar uma alteração mais antiga que a que já está no servidor, ignora
create or replace function public.kf_produto_ultima_vence() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.atualizado_em < old.atualizado_em then
      return old;
    end if;
  end if;
  new.servidor_em := clock_timestamp();
  return new;
end $$;

drop trigger if exists kf_servidor on public.produtos;
create trigger kf_servidor before insert or update on public.produtos
  for each row execute function public.kf_produto_ultima_vence();
drop trigger if exists kf_servidor on public.conferencias;
create trigger kf_servidor before insert or update on public.conferencias
  for each row execute function public.kf_marcar_servidor();
drop trigger if exists kf_servidor on public.config;
create trigger kf_servidor before insert or update on public.config
  for each row execute function public.kf_marcar_servidor();

-- ---------- funções de permissão ----------
create or replace function public.kf_e_membro() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.membros where user_id = auth.uid());
$$;

create or replace function public.kf_e_dono() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.membros where user_id = auth.uid() and papel = 'dono');
$$;

-- Entrar na clínica depois de criar a conta.
-- A primeira pessoa vira DONO. As seguintes precisam do código da clínica e viram funcionário.
create or replace function public.kf_entrar(p_nome text, p_codigo text default null)
returns public.membros
language plpgsql security definer set search_path = public as $$
declare
  m public.membros;
begin
  if auth.uid() is null then raise exception 'Faça login primeiro'; end if;
  select * into m from public.membros where user_id = auth.uid();
  if found then return m; end if;
  if length(trim(coalesce(p_nome, ''))) = 0 then raise exception 'Informe seu nome'; end if;
  perform pg_advisory_xact_lock(4242);
  if not exists (select 1 from public.membros where papel = 'dono') then
    insert into public.membros (user_id, nome, papel) values (auth.uid(), trim(p_nome), 'dono') returning * into m;
  else
    if p_codigo is null or upper(trim(p_codigo)) <> (select codigo_convite from public.config where id = 1) then
      raise exception 'Código da clínica inválido';
    end if;
    insert into public.membros (user_id, nome, papel) values (auth.uid(), trim(p_nome), 'funcionario') returning * into m;
  end if;
  return m;
end $$;

-- Dono gera um código novo (o antigo deixa de valer para novos cadastros)
create or replace function public.kf_novo_codigo() returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.kf_e_dono() then raise exception 'Só o dono pode fazer isso'; end if;
  c := upper(substr(md5(random()::text), 1, 6));
  update public.config set codigo_convite = c where id = 1;
  return c;
end $$;

-- Dono remove o acesso de alguém (não pode remover a si mesmo)
create or replace function public.kf_remover_membro(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.kf_e_dono() then raise exception 'Só o dono pode fazer isso'; end if;
  if p_user = auth.uid() then raise exception 'O dono não pode remover a si mesmo'; end if;
  delete from public.membros where user_id = p_user;
end $$;

revoke all on function public.kf_entrar(text, text) from public, anon;
revoke all on function public.kf_novo_codigo() from public, anon;
revoke all on function public.kf_remover_membro(uuid) from public, anon;
grant execute on function public.kf_entrar(text, text) to authenticated;
grant execute on function public.kf_novo_codigo() to authenticated;
grant execute on function public.kf_remover_membro(uuid) to authenticated;
grant execute on function public.kf_e_membro() to authenticated;
grant execute on function public.kf_e_dono() to authenticated;

-- ---------- permissões (RLS) ----------
alter table public.membros      enable row level security;
alter table public.config       enable row level security;
alter table public.produtos     enable row level security;
alter table public.conferencias enable row level security;

revoke all on public.membros, public.config, public.produtos, public.conferencias from anon, authenticated;
grant select on public.membros to authenticated;
grant select, update on public.config to authenticated;
grant select, insert, update on public.produtos to authenticated;
grant select, insert on public.conferencias to authenticated;

drop policy if exists kf_membros_ler on public.membros;
create policy kf_membros_ler on public.membros for select to authenticated
  using (public.kf_e_membro());

drop policy if exists kf_config_ler on public.config;
create policy kf_config_ler on public.config for select to authenticated
  using (public.kf_e_membro());
drop policy if exists kf_config_dono on public.config;
create policy kf_config_dono on public.config for update to authenticated
  using (public.kf_e_dono()) with check (public.kf_e_dono());

drop policy if exists kf_produtos_ler on public.produtos;
create policy kf_produtos_ler on public.produtos for select to authenticated
  using (public.kf_e_membro());
drop policy if exists kf_produtos_criar on public.produtos;
create policy kf_produtos_criar on public.produtos for insert to authenticated
  with check (public.kf_e_membro());
drop policy if exists kf_produtos_alterar on public.produtos;
create policy kf_produtos_alterar on public.produtos for update to authenticated
  using (public.kf_e_membro()) with check (public.kf_e_membro());

drop policy if exists kf_conf_ler on public.conferencias;
create policy kf_conf_ler on public.conferencias for select to authenticated
  using (public.kf_e_membro());
drop policy if exists kf_conf_criar on public.conferencias;
create policy kf_conf_criar on public.conferencias for insert to authenticated
  with check (public.kf_e_membro() and por_user = auth.uid());

-- ---------- fotos (Storage) ----------
insert into storage.buckets (id, name, public)
values ('fotos', 'fotos', false)
on conflict (id) do nothing;

drop policy if exists kf_fotos_ler on storage.objects;
create policy kf_fotos_ler on storage.objects for select to authenticated
  using (bucket_id = 'fotos' and public.kf_e_membro());
drop policy if exists kf_fotos_enviar on storage.objects;
create policy kf_fotos_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and public.kf_e_membro());
drop policy if exists kf_fotos_trocar on storage.objects;
create policy kf_fotos_trocar on storage.objects for update to authenticated
  using (bucket_id = 'fotos' and public.kf_e_membro()) with check (bucket_id = 'fotos' and public.kf_e_membro());

-- ---------- tempo real (avisa os celulares quando algo muda) ----------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['produtos', 'conferencias', 'config'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

select 'Pronto! Banco do Estoque KF configurado.' as resultado;
