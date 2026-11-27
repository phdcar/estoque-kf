-- =====================================================================
-- Estoque KF versão 0.9: aviso ao dono quando a conferência de segunda-feira atrasa.
-- Precisa de avisos-email.sql, push.sql e migracao-0.8.sql já aplicados. Pode rodar de novo.
--  * Toda segunda-feira, a cada 10 minutos, o banco confere: passou do horário limite
--    (Ajustes → Conferência → Horário limite, padrão 18:00) e ninguém fez a contagem de hoje?
--    Então avisa o dono uma única vez: notificação no celular e e-mail.
-- =====================================================================

-- guarda os dias em que o aviso já saiu (para não repetir)
create table if not exists public.kf_aviso_atraso (
  dia        date primary key,
  enviado_em timestamptz not null default now()
);
alter table public.kf_aviso_atraso enable row level security;
revoke all on public.kf_aviso_atraso from anon, authenticated;

create or replace function public.kf_aviso_atrasada(p_agora timestamptz default now()) returns text
language plpgsql security definer set search_path = public as $$
declare
  local timestamp := p_agora at time zone 'America/Sao_Paulo';
  hoje date := local::date;
  cfg record;
  prazo time;
  n int;
begin
  if extract(isodow from hoje) <> 1 then return 'hoje não é segunda-feira'; end if;
  select * into cfg from public.config where id = 1;
  if cfg is null or cfg.inicio > hoje then return 'conferência ainda não começou'; end if;
  -- só cobra se havia produto cadastrado antes de hoje (igual ao app)
  if not exists (select 1 from public.produtos where not excluido and (criado_em at time zone 'America/Sao_Paulo')::date < hoje) then
    return 'sem produtos';
  end if;
  begin prazo := coalesce(nullif(cfg.prazo, ''), '18:00')::time; exception when others then prazo := '18:00'; end;
  if local::time < prazo then return 'ainda no prazo'; end if;
  if exists (select 1 from public.conferencias where dia = hoje and justificativa is null) then return 'já conferido'; end if;
  insert into public.kf_aviso_atraso (dia) values (hoje) on conflict (dia) do nothing;
  get diagnostics n = row_count;
  if n = 0 then return 'aviso já enviado hoje'; end if;
  -- kf_enviar_email também manda a notificação para o celular do dono
  perform public.kf_enviar_email('Estoque KF · Conferência de segunda-feira atrasada',
    '<p>A conferência do estoque de hoje (' || to_char(hoje, 'DD/MM/YYYY') || ') ainda não foi feita.</p>'
    || '<p>O horário limite era ' || to_char(prazo, 'HH24:MI') || '. '
    || 'Se ninguém contar hoje, o funcionário vai precisar escrever uma justificativa amanhã para usar o app.</p>'
    || '<p><a href="https://phdcar.github.io/estoque-kf/#painel">Abrir o app</a></p>');
  return 'aviso enviado';
exception when others then raise warning 'kf_aviso_atrasada: %', sqlerrm; return 'erro';
end $$;
revoke all on function public.kf_aviso_atrasada(timestamptz) from public, anon, authenticated;

-- Ajustes do dono: quantos celulares de cada pessoa estão com os avisos ligados
create or replace function public.kf_push_resumo() returns table (user_id uuid, celulares int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.kf_e_dono() then raise exception 'Só o dono pode fazer isso'; end if;
  return query select m.user_id, (select count(*)::int from public.kf_push_inscricoes i where i.user_id = m.user_id) from public.membros m;
end $$;
revoke all on function public.kf_push_resumo() from public, anon;
grant execute on function public.kf_push_resumo() to authenticated;

-- segunda-feira à noite em Brasília já é terça em UTC, por isso roda segunda e terça (a função confere o dia local)
do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'kf-aviso-atrasada';
  perform cron.schedule('kf-aviso-atrasada', '*/10 * * * 1,2', 'select public.kf_aviso_atrasada()');
exception when others then raise notice 'pg_cron: %', sqlerrm;
end $$;

select 'Versão 0.9 instalada: aviso de conferência atrasada para o dono.' as resultado;
