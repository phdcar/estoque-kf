-- Estoque KF versão 0.7: consumo e previsão, pedidos de compra, lotes com validade,
-- preço (custo do estoque) e código de barras. Pode rodar de novo sem problema.

-- produto: preço unitário, código de barras e lotes [{id, validade, qtd}]
alter table public.produtos add column if not exists preco numeric(12,2) check (preco is null or preco >= 0);
alter table public.produtos add column if not exists codigo_barras text;
alter table public.produtos add column if not exists lotes jsonb not null default '[]'::jsonb;

-- movimentos: cada entrada, saída, ajuste, conferência ou perda (só se acrescenta, nunca se altera)
create table if not exists public.movimentos (
  id          uuid primary key,
  produto_id  uuid not null,
  produto     text not null,
  tipo        text not null check (tipo in ('entrada', 'saida', 'ajuste', 'conferencia', 'perda')),
  delta       int  not null,
  antes       int  not null,
  depois      int  not null check (depois >= 0),
  preco       numeric(12,2),
  fornecedor  text,
  pedido_id   uuid,
  obs         text,
  por_nome    text not null,
  por_user    uuid default auth.uid() references auth.users(id) on delete set null,
  feito_em    timestamptz not null,
  servidor_em timestamptz not null default now()
);
create index if not exists movimentos_servidor_em on public.movimentos (servidor_em);
create index if not exists movimentos_produto on public.movimentos (produto_id, feito_em);

-- pedidos de compra por fornecedor (vence a alteração mais recente, como no produto)
create table if not exists public.pedidos (
  id             uuid primary key,
  fornecedor     text not null,
  itens          jsonb not null,           -- [{id, nome, qtd, preco, recebido}]
  status         text not null check (status in ('feito', 'recebido', 'cancelado')),
  criado_em      timestamptz not null,
  criado_por     text,
  recebido_em    timestamptz,
  recebido_por   text,
  atualizado_em  timestamptz not null,
  servidor_em    timestamptz not null default now()
);
create index if not exists pedidos_servidor_em on public.pedidos (servidor_em);

drop trigger if exists kf_servidor on public.movimentos;
create trigger kf_servidor before insert or update on public.movimentos
  for each row execute function public.kf_marcar_servidor();
drop trigger if exists kf_servidor on public.pedidos;
create trigger kf_servidor before insert or update on public.pedidos
  for each row execute function public.kf_produto_ultima_vence();

alter table public.movimentos enable row level security;
alter table public.pedidos    enable row level security;
revoke all on public.movimentos, public.pedidos from anon, authenticated;
grant select, insert on public.movimentos to authenticated;
grant select, insert, update on public.pedidos to authenticated;
grant select on public.movimentos, public.pedidos to service_role;

drop policy if exists kf_mov_ler on public.movimentos;
create policy kf_mov_ler on public.movimentos for select to authenticated using (public.kf_e_membro());
drop policy if exists kf_mov_criar on public.movimentos;
create policy kf_mov_criar on public.movimentos for insert to authenticated
  with check (public.kf_e_membro() and por_user = auth.uid());
drop policy if exists kf_ped_ler on public.pedidos;
create policy kf_ped_ler on public.pedidos for select to authenticated using (public.kf_e_membro());
drop policy if exists kf_ped_criar on public.pedidos;
create policy kf_ped_criar on public.pedidos for insert to authenticated with check (public.kf_e_membro());
drop policy if exists kf_ped_alterar on public.pedidos;
create policy kf_ped_alterar on public.pedidos for update to authenticated
  using (public.kf_e_membro()) with check (public.kf_e_membro());

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['movimentos', 'pedidos'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

select 'Versão 0.7 instalada: movimentos, pedidos, lotes, preço e código de barras.' as resultado;
