-- Estoque KF versão 0.8.3: a conferência passa a ser semanal, toda segunda-feira (pedido do dono em 27/11/2026).
-- O lembrete das 17h só sai na segunda-feira. Pode rodar de novo.
create or replace function public.kf_lembrete_conferencia(p_agora timestamptz default now()) returns text
language plpgsql security definer set search_path = public as $$
declare
  hoje date := (p_agora at time zone 'America/Sao_Paulo')::date;
  cfg record;
begin
  if extract(isodow from hoje) <> 1 then return 'hoje não é segunda-feira'; end if;
  select * into cfg from public.config where id = 1;
  if cfg is null or cfg.inicio > hoje then return 'conferência ainda não começou'; end if;
  if not exists (select 1 from public.produtos where not excluido) then return 'sem produtos'; end if;
  if exists (select 1 from public.conferencias where dia = hoje and justificativa is null) then return 'já conferido'; end if;
  perform public.kf_enviar_push_todos('Conferência de segunda-feira',
    'O estoque ainda não foi conferido hoje. O prazo é às ' || replace(cfg.prazo, ':00', 'h') || '.');
  return 'lembrete enviado';
exception when others then raise warning 'kf_lembrete_conferencia: %', sqlerrm; return 'erro';
end $$;
revoke all on function public.kf_lembrete_conferencia(timestamptz) from public, anon, authenticated;

do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'kf-lembrete-conferencia';
  perform cron.schedule('kf-lembrete-conferencia', '0 20 * * 1', 'select public.kf_lembrete_conferencia()');
exception when others then raise notice 'pg_cron: %', sqlerrm;
end $$;

select 'Versão 0.8.3 instalada: conferência toda segunda-feira.' as resultado;
