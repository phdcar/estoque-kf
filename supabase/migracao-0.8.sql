-- =====================================================================
-- Estoque KF versão 0.8: lembrete da conferência às 17h e resumo da manhã no celular.
-- Precisa de push.sql já aplicado. Pode rodar de novo.
--  * Lembrete (segunda a sexta, 17h de Brasília): se a conferência de hoje ainda não foi feita,
--    avisa todos os celulares com notificações ativadas (dono e funcionários).
--  * Resumo da manhã (segunda a sexta, 8h de Brasília): se houver esgotado, abaixo do mínimo
--    ou vencido, avisa o dono. Também atualiza o número no ícone do app.
-- =====================================================================

-- todos os celulares inscritos de quem ainda é membro da clínica
create or replace function public.kf_push_destinos_todos() returns setof public.kf_push_inscricoes
language sql security definer set search_path = public stable as $$
  select i.* from public.kf_push_inscricoes i join public.membros m on m.user_id = i.user_id;
$$;
revoke all on function public.kf_push_destinos_todos() from public, anon, authenticated;
grant execute on function public.kf_push_destinos_todos() to service_role;

-- envia o push para todos (nunca dá erro para quem chamou)
create or replace function public.kf_enviar_push_todos(p_titulo text, p_corpo text) returns void
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select * into c from public.kf_push_config where id = 1;
  if c is null or not exists (select 1 from public.kf_push_destinos_todos()) then return; end if;
  perform net.http_post(
    url := c.funcao_url,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('acao', 'enviar', 'todos', true, 'segredo', c.segredo, 'title', p_titulo, 'body', p_corpo, 'badge', public.kf_push_badge()));
exception when others then raise warning 'kf_enviar_push_todos: %', sqlerrm;
end $$;
revoke all on function public.kf_enviar_push_todos(text, text) from public, anon, authenticated;

-- lembrete das 17h: só em dia útil, depois da data inicial, com produto cadastrado e sem conferência hoje
drop function if exists public.kf_lembrete_conferencia();
create or replace function public.kf_lembrete_conferencia(p_agora timestamptz default now()) returns text
language plpgsql security definer set search_path = public as $$
declare
  hoje date := (p_agora at time zone 'America/Sao_Paulo')::date;
  cfg record;
begin
  if extract(isodow from hoje) > 5 then return 'fim de semana'; end if;
  select * into cfg from public.config where id = 1;
  if cfg is null or cfg.inicio > hoje then return 'conferência ainda não começou'; end if;
  if not exists (select 1 from public.produtos where not excluido) then return 'sem produtos'; end if;
  if exists (select 1 from public.conferencias where dia = hoje and justificativa is null) then return 'já conferido'; end if;
  perform public.kf_enviar_push_todos('Conferência de hoje',
    'O estoque ainda não foi conferido hoje. O prazo é às ' || replace(cfg.prazo, ':00', 'h') || '.');
  return 'lembrete enviado';
exception when others then raise warning 'kf_lembrete_conferencia: %', sqlerrm; return 'erro';
end $$;
revoke all on function public.kf_lembrete_conferencia(timestamptz) from public, anon, authenticated;

-- resumo da manhã para o dono
drop function if exists public.kf_resumo_manha();
create or replace function public.kf_resumo_manha(p_agora timestamptz default now()) returns text
language plpgsql security definer set search_path = public as $$
declare
  hoje date := (p_agora at time zone 'America/Sao_Paulo')::date;
  esg int; baixo int; venc int; partes text[] := '{}';
begin
  if extract(isodow from hoje) > 5 then return 'fim de semana'; end if;
  select count(*) filter (where quantidade = 0),
         count(*) filter (where quantidade > 0 and quantidade < minimo),
         count(*) filter (where not sem_validade and validade is not null and validade < hoje)
    into esg, baixo, venc
    from public.produtos where not excluido;
  if esg > 0 then partes := partes || (esg || case when esg = 1 then ' esgotado' else ' esgotados' end); end if;
  if baixo > 0 then partes := partes || (baixo || ' abaixo do mínimo'); end if;
  if venc > 0 then partes := partes || (venc || case when venc = 1 then ' vencido' else ' vencidos' end); end if;
  if cardinality(partes) = 0 then return 'nada a avisar'; end if;
  perform public.kf_enviar_push('Bom dia · estoque', array_to_string(partes, ' · ') || '. Toque para ver o pedido sugerido.');
  return array_to_string(partes, ' · ');
exception when others then raise warning 'kf_resumo_manha: %', sqlerrm; return 'erro';
end $$;
revoke all on function public.kf_resumo_manha(timestamptz) from public, anon, authenticated;

-- Brasília não tem horário de verão desde 2019: 17h = 20h UTC; 8h = 11h UTC
do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname in ('kf-lembrete-conferencia', 'kf-resumo-manha');
  perform cron.schedule('kf-lembrete-conferencia', '0 20 * * 1-5', 'select public.kf_lembrete_conferencia()');
  perform cron.schedule('kf-resumo-manha', '2 11 * * 1-5', 'select public.kf_resumo_manha()');
exception when others then raise notice 'pg_cron: %', sqlerrm;
end $$;

select 'Versão 0.8 instalada. Celulares inscritos: ' || (select count(*) from public.kf_push_inscricoes) as resultado;
