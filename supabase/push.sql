-- =====================================================================
-- Estoque KF: notificações push no celular do dono (e número no ícone)
-- O banco chama a função "kf-push" (Supabase Edge Functions) a cada aviso.
-- As chaves VAPID são criadas pela própria função; o segredo entre banco e função
-- é gerado aqui. Ninguém precisa copiar chave nenhuma. Pode rodar de novo.
-- Depois de rodar este arquivo, rode de novo supabase/avisos-email.sql.
-- =====================================================================
create table if not exists public.kf_push_config (
  id            int primary key default 1 check (id = 1),
  vapid_publica text,
  vapid_privada jsonb,
  segredo       text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  funcao_url    text not null default 'https://jmaghjeoucunvidtqeke.supabase.co/functions/v1/kf-push'
);
insert into public.kf_push_config (id) values (1) on conflict (id) do nothing;
alter table public.kf_push_config enable row level security;
revoke all on public.kf_push_config from anon, authenticated;
grant select, update on public.kf_push_config to service_role;

-- inscrições: cada celular que ativou as notificações
create table if not exists public.kf_push_inscricoes (
  endpoint  text primary key,
  p256dh    text not null,
  auth      text not null,
  user_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now()
);
alter table public.kf_push_inscricoes enable row level security;
revoke all on public.kf_push_inscricoes from anon, authenticated;
grant select, insert, update, delete on public.kf_push_inscricoes to authenticated;
grant select, delete on public.kf_push_inscricoes to service_role;
drop policy if exists kf_push_proprio on public.kf_push_inscricoes;
create policy kf_push_proprio on public.kf_push_inscricoes for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.kf_e_membro());

-- celulares que recebem: os do dono
create or replace function public.kf_push_destinos() returns setof public.kf_push_inscricoes
language sql security definer set search_path = public stable as $$
  select i.* from public.kf_push_inscricoes i join public.membros m on m.user_id = i.user_id where m.papel = 'dono';
$$;
revoke all on function public.kf_push_destinos() from public, anon, authenticated;
grant execute on function public.kf_push_destinos() to service_role;

-- número do ícone: abaixo do alerta + vencidos
create or replace function public.kf_push_badge() returns int
language sql security definer set search_path = public stable as $$
  select count(*)::int from public.produtos
   where not excluido and (quantidade < minimo
      or (not sem_validade and validade is not null and validade < (now() at time zone 'America/Sao_Paulo')::date));
$$;

-- envia o push (nunca dá erro para quem chamou)
create or replace function public.kf_enviar_push(p_titulo text, p_corpo text) returns void
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select * into c from public.kf_push_config where id = 1;
  if c is null or not exists (select 1 from public.kf_push_destinos()) then return; end if;
  perform net.http_post(
    url := c.funcao_url,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('acao', 'enviar', 'segredo', c.segredo, 'title', p_titulo, 'body', p_corpo, 'badge', public.kf_push_badge()));
exception when others then raise warning 'kf_enviar_push: %', sqlerrm;
end $$;
revoke all on function public.kf_enviar_push(text, text) from public, anon, authenticated;

select 'Push instalado. Celulares inscritos: ' || (select count(*) from public.kf_push_inscricoes) as resultado;
