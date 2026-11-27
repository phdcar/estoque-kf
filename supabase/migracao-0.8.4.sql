-- Estoque KF versão 0.8.4: o resumo das 8h vai para o dono só na segunda-feira (pedido do dono em 27/11/2026).
-- Pode rodar de novo.
-- resumo da manhã para o dono
create or replace function public.kf_resumo_manha(p_agora timestamptz default now()) returns text
language plpgsql security definer set search_path = public as $$
declare
  hoje date := (p_agora at time zone 'America/Sao_Paulo')::date;
  esg int; baixo int; venc int; partes text[] := '{}';
begin
  if extract(isodow from hoje) <> 1 then return 'hoje não é segunda-feira'; end if;
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

do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'kf-resumo-manha';
  perform cron.schedule('kf-resumo-manha', '2 11 * * 1', 'select public.kf_resumo_manha()');
exception when others then raise notice 'pg_cron: %', sqlerrm;
end $$;

select 'Versão 0.8.4 instalada: resumo das 8h só na segunda-feira.' as resultado;
