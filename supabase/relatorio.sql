-- Estoque KF versão 0.7: relatório mensal em PDF por e-mail.
-- A função "kf-relatorio" (Supabase Edge Functions) monta o PDF e envia pelo Resend.
-- Rode depois de push.sql (usa o segredo de kf_push_config). Pode rodar de novo.

-- dados que só a função (service_role) pode ler: chave do Resend no Vault e e-mail de destino
create or replace function public.kf_relatorio_envio() returns jsonb
language plpgsql security definer set search_path = public as $$
declare k text; dest text;
begin
  select email into dest from public.kf_avisos where id = 1;
  begin
    select decrypted_secret into k from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
  exception when others then k := null;
  end;
  return jsonb_build_object('email', dest, 'chave', k);
end $$;
revoke all on function public.kf_relatorio_envio() from public, anon, authenticated;
grant execute on function public.kf_relatorio_envio() to service_role;

grant select on public.produtos, public.conferencias, public.config, public.membros to service_role;

-- todo dia 1º às 8h (Brasília) manda o relatório do mês anterior
create or replace function public.kf_relatorio_mensal() returns void
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select segredo, replace(funcao_url, 'kf-push', 'kf-relatorio') as url into c from public.kf_push_config where id = 1;
  if c.url is null then return; end if;
  perform net.http_post(url := c.url, headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('acao', 'mensal', 'segredo', c.segredo));
exception when others then raise warning 'kf_relatorio_mensal: %', sqlerrm;
end $$;
revoke all on function public.kf_relatorio_mensal() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'kf-relatorio-mensal';
  perform cron.schedule('kf-relatorio-mensal', '0 11 1 * *', 'select public.kf_relatorio_mensal()');
exception when others then raise notice 'pg_cron: %', sqlerrm;
end $$;

select 'Relatório mensal instalado.' as resultado;
