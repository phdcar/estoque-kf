-- =====================================================================
-- Estoque KF: aviso por e-mail ao dono a cada mudança no estoque
-- O próprio banco manda o e-mail (pelo Resend) assim que a mudança chega,
-- mesmo com o app fechado. Mudanças que chegam juntas viram um e-mail só.
-- Pré-requisitos:
--   1) segredo "resend_api_key" no Vault do Supabase (Integrations → Vault)
--   2) e-mail de destino: update public.kf_avisos set email = '...';
-- Pode rodar de novo sem problema. Se faltar a chave ou o e-mail, não manda nada
-- e NUNCA impede o estoque de ser salvo.
-- =====================================================================

do $$ begin
  create extension if not exists pg_net;
exception when others then raise notice 'pg_net: %', sqlerrm;
end $$;

-- configuração (sem acesso pelo app: só o SQL Editor mexe aqui)
create table if not exists public.kf_avisos (
  id      int primary key default 1 check (id = 1),
  email   text,              -- para quem vai o aviso
  ligado  boolean not null default true
);
insert into public.kf_avisos (id) values (1) on conflict (id) do nothing;
alter table public.kf_avisos enable row level security;
revoke all on public.kf_avisos from anon, authenticated;

-- registro dos envios (para conferir se saiu)
create table if not exists public.kf_avisos_log (
  id       bigserial primary key,
  enviado  timestamptz not null default now(),
  assunto  text,
  pedido   bigint,           -- id do pedido no pg_net
  erro     text
);
alter table public.kf_avisos_log enable row level security;
revoke all on public.kf_avisos_log from anon, authenticated;

create or replace function public.kf_html(t text) returns text
language sql immutable as $$
  select replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
$$;

-- envia um e-mail (nunca dá erro para quem chamou)
create or replace function public.kf_enviar_email(p_assunto text, p_html text) returns void
language plpgsql security definer set search_path = public as $$
declare
  k text; dest text; ok boolean; req bigint;
begin
  select email, ligado into dest, ok from public.kf_avisos where id = 1;
  if not coalesce(ok, false) or coalesce(dest, '') = '' then return; end if;
  begin
    select decrypted_secret into k from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
  exception when others then k := null;
  end;
  if coalesce(k, '') = '' then
    insert into public.kf_avisos_log (assunto, erro) values (p_assunto, 'falta o segredo resend_api_key no Vault');
    return;
  end if;
  select net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || k, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', 'Estoque Clínica KF <onboarding@resend.dev>',
      'to', jsonb_build_array(dest),
      'subject', p_assunto,
      'html', p_html)
  ) into req;
  insert into public.kf_avisos_log (assunto, pedido) values (p_assunto, req);
exception when others then
  begin insert into public.kf_avisos_log (assunto, erro) values (p_assunto, sqlerrm); exception when others then null; end;
end $$;
revoke all on function public.kf_enviar_email(text, text) from public, anon, authenticated;

-- monta o e-mail de produtos alterados (chamado pelos gatilhos com as linhas antes/depois)
create or replace function public.kf_aviso_produtos(p_mud jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  r jsonb; n int; baixos int; quem text; linhas text := ''; assunto text; tipo text; det text; cor text;
  quando text := to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI');
begin
  n := jsonb_array_length(p_mud);
  if n = 0 then return; end if;
  select count(*) into baixos from jsonb_array_elements(p_mud) e
   where not (e->>'excluido')::boolean and (e->>'qtd')::int < (e->>'min')::int;
  select string_agg(distinct coalesce(e->>'por', '?'), ', ') into quem from jsonb_array_elements(p_mud) e;
  for r in select e from jsonb_array_elements(p_mud) e order by e->>'nome' loop
    tipo := r->>'tipo';
    det := case tipo
      when 'novo' then 'Cadastrado com ' || (r->>'qtd')
      when 'excluido' then 'Excluído'
      when 'qtd' then (r->>'qtd_antes') || ' → <b>' || (r->>'qtd') || '</b>'
      else 'Cadastro alterado' end;
    if r->>'extra' <> '' then det := det || '<br><small style="color:#6E675C">' || kf_html(r->>'extra') || '</small>'; end if;
    cor := case when tipo <> 'excluido' and (r->>'qtd')::int < (r->>'min')::int then '#FBEDEB' else '#FFFFFF' end;
    linhas := linhas || format(
      '<tr style="background:%s"><td style="padding:8px;border-bottom:1px solid #E7E0D4">%s%s</td><td style="padding:8px;border-bottom:1px solid #E7E0D4">%s</td><td style="padding:8px;border-bottom:1px solid #E7E0D4;text-align:center">%s</td></tr>',
      cor, kf_html(r->>'nome'),
      case when cor = '#FBEDEB' then '<br><b style="color:#B3261E">ABAIXO DO MÍNIMO</b>' else '' end,
      det, case when (r->>'min')::int >= 1 then r->>'min' else '—' end);
  end loop;
  if n = 1 then
    r := p_mud->0;
    assunto := 'Estoque KF · ' || (r->>'nome') || ': ' ||
      case r->>'tipo' when 'qtd' then (r->>'qtd_antes') || ' → ' || (r->>'qtd') when 'novo' then 'novo produto'
        when 'excluido' then 'excluído' else 'cadastro alterado' end || ' (' || coalesce(r->>'por', '?') || ')';
  else
    assunto := 'Estoque KF · ' || n || ' produtos alterados (' || coalesce(quem, '?') || ')';
  end if;
  if baixos > 0 then assunto := assunto || ' · ' || baixos || ' abaixo do mínimo'; end if;
  perform kf_enviar_email(assunto, format(
    '<div style="font-family:Arial,sans-serif;color:#121A24;max-width:560px">'
    '<div style="background:#121A24;color:#F3EFE7;padding:14px 18px;border-radius:10px 10px 0 0"><b style="font-size:17px">Clínica KF</b><br><span style="color:#CDB27E;font-size:12px;letter-spacing:2px">ESTOQUE</span></div>'
    '<p>%s por <b>%s</b>, em %s.</p>'
    '<table style="border-collapse:collapse;width:100%%;font-size:14px"><tr style="text-align:left;color:#6E675C"><th style="padding:8px">Produto</th><th style="padding:8px">Mudança</th><th style="padding:8px">Mínimo</th></tr>%s</table>'
    '<p style="color:#6E675C;font-size:12px">Aviso automático do app de estoque.</p></div>',
    case when n = 1 then '1 produto alterado' else n || ' produtos alterados' end,
    kf_html(quem), quando, linhas));
exception when others then raise warning 'kf_aviso_produtos: %', sqlerrm;
end $$;
revoke all on function public.kf_aviso_produtos(jsonb) from public, anon, authenticated;

-- gatilhos por comando: um e-mail por envio do app, com todas as linhas juntas
create or replace function public.kf_produtos_aviso_upd() returns trigger
language plpgsql security definer set search_path = public as $$
declare mud jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'nome', n.nome, 'por', n.atualizado_por, 'qtd', n.quantidade, 'qtd_antes', o.quantidade, 'min', n.minimo,
      'excluido', n.excluido,
      'tipo', case when n.excluido and not o.excluido then 'excluido'
                   when n.quantidade <> o.quantidade then 'qtd' else 'cad' end,
      'extra', concat_ws(' · ',
        case when n.nome <> o.nome then 'nome: ' || o.nome || ' → ' || n.nome end,
        case when n.minimo <> o.minimo then 'mínimo ' || o.minimo || ' → ' || n.minimo end,
        case when n.fornecedor is distinct from o.fornecedor then 'fornecedor: ' || coalesce(n.fornecedor, '—') end,
        case when n.categoria is distinct from o.categoria then 'categoria: ' || coalesce(n.categoria, '—') end,
        case when n.foto_chave is distinct from o.foto_chave then 'foto nova' end,
        case when (n.validade, n.sem_validade) is distinct from (o.validade, o.sem_validade) then
          'validade: ' || case when n.sem_validade then 'ND (sem validade)' when n.validade is null then '—' else to_char(n.validade, 'DD/MM/YYYY') end end))), '[]'::jsonb)
    into mud
    from novas n join antigas o on o.id = n.id
   where (n.quantidade, n.minimo, n.nome, n.excluido, coalesce(n.fornecedor, ''), coalesce(n.categoria, ''), coalesce(n.foto_chave, ''), n.validade, n.sem_validade)
         is distinct from
         (o.quantidade, o.minimo, o.nome, o.excluido, coalesce(o.fornecedor, ''), coalesce(o.categoria, ''), coalesce(o.foto_chave, ''), o.validade, o.sem_validade);
  perform kf_aviso_produtos(mud);
  return null;
exception when others then raise warning 'kf_produtos_aviso_upd: %', sqlerrm; return null;
end $$;

create or replace function public.kf_produtos_aviso_ins() returns trigger
language plpgsql security definer set search_path = public as $$
declare mud jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'nome', n.nome, 'por', coalesce(n.atualizado_por, n.criado_por), 'qtd', n.quantidade, 'qtd_antes', null,
      'min', n.minimo, 'excluido', n.excluido, 'tipo', 'novo',
      'extra', concat_ws(' · ', n.fornecedor, n.categoria,
        case when n.sem_validade then 'sem validade' when n.validade is not null then 'validade ' || to_char(n.validade, 'DD/MM/YYYY') end))), '[]'::jsonb)
    into mud from novas n where not n.excluido;
  perform kf_aviso_produtos(mud);
  return null;
exception when others then raise warning 'kf_produtos_aviso_ins: %', sqlerrm; return null;
end $$;

create or replace function public.kf_conferencia_aviso() returns trigger
language plpgsql security definer set search_path = public as $$
declare c record; difs int; total int; lista text;
begin
  for c in select * from novas loop
    select count(*), count(*) filter (where (i->>'counted')::int <> (i->>'before')::int),
           string_agg(case when (i->>'counted')::int <> (i->>'before')::int then
             format('<li>%s: sistema %s, contado <b>%s</b></li>', kf_html(i->>'name'), i->>'before', i->>'counted') end, '')
      into total, difs, lista
      from jsonb_array_elements(c.itens) i;
    perform kf_enviar_email(
      format('Estoque KF · Conferência feita por %s (%s produtos, %s com diferença)', c.por_nome, total, difs),
      format('<div style="font-family:Arial,sans-serif;color:#121A24;max-width:560px"><p>Conferência do dia %s feita por <b>%s</b> em %s.</p><p>%s produtos contados, %s com diferença.</p>%s</div>',
        to_char(c.dia, 'DD/MM/YYYY'), kf_html(c.por_nome), to_char(c.feita_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI'),
        total, difs, case when difs > 0 then '<ul>' || lista || '</ul>' else '' end));
  end loop;
  return null;
exception when others then raise warning 'kf_conferencia_aviso: %', sqlerrm; return null;
end $$;

-- aviso diário de validade (8h de Brasília): só manda quando algum produto chega a 30, 7, 1 ou 0 dias,
-- ou venceu ontem; assim o e-mail não se repete todo dia com a mesma lista.
create or replace function public.kf_aviso_validade() returns void
language plpgsql security definer set search_path = public as $$
declare hoje date := (now() at time zone 'America/Sao_Paulo')::date; marcos int; vencidos int; lista text;
begin
  select count(*) filter (where validade - hoje in (30, 7, 1, 0, -1)), count(*) filter (where validade < hoje),
         string_agg(format('<tr style="background:%s"><td style="padding:8px;border-bottom:1px solid #E7E0D4">%s</td><td style="padding:8px;border-bottom:1px solid #E7E0D4">%s</td><td style="padding:8px;border-bottom:1px solid #E7E0D4">%s</td></tr>',
           case when validade < hoje then '#FBEDEB' else '#FFFFFF' end, kf_html(nome), to_char(validade, 'DD/MM/YYYY'),
           case when validade < hoje then '<b style="color:#B3261E">vencido há ' || (hoje - validade) || ' dia(s)</b>'
                when validade = hoje then '<b>vence hoje</b>' else 'vence em ' || (validade - hoje) || ' dia(s)' end), '' order by validade, nome)
    into marcos, vencidos, lista
    from public.produtos where not excluido and not sem_validade and validade is not null and validade <= hoje + 30;
  if coalesce(marcos, 0) = 0 then return; end if;
  perform kf_enviar_email(
    'Estoque KF · Validade: ' || marcos || ' produto(s) chegando ao prazo' || case when vencidos > 0 then ' · ' || vencidos || ' vencido(s)' else '' end,
    format('<div style="font-family:Arial,sans-serif;color:#121A24;max-width:560px">'
      '<div style="background:#121A24;color:#F3EFE7;padding:14px 18px;border-radius:10px 10px 0 0"><b style="font-size:17px">Clínica KF</b><br><span style="color:#CDB27E;font-size:12px;letter-spacing:2px">VALIDADE</span></div>'
      '<p>Produtos vencidos ou que vencem nos próximos 30 dias, em %s:</p>'
      '<table style="border-collapse:collapse;width:100%%;font-size:14px"><tr style="text-align:left;color:#6E675C"><th style="padding:8px">Produto</th><th style="padding:8px">Validade</th><th style="padding:8px">Situação</th></tr>%s</table>'
      '<p style="color:#6E675C;font-size:12px">Aviso automático do app de estoque.</p></div>', to_char(hoje, 'DD/MM/YYYY'), lista));
exception when others then raise warning 'kf_aviso_validade: %', sqlerrm;
end $$;
revoke all on function public.kf_aviso_validade() from public, anon, authenticated;

do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'kf-aviso-validade';
  perform cron.schedule('kf-aviso-validade', '0 11 * * *', 'select public.kf_aviso_validade()');
exception when others then raise notice 'pg_cron: %', sqlerrm;
end $$;

drop trigger if exists kf_aviso_upd on public.produtos;
create trigger kf_aviso_upd after update on public.produtos
  referencing old table as antigas new table as novas
  for each statement execute function public.kf_produtos_aviso_upd();
drop trigger if exists kf_aviso_ins on public.produtos;
create trigger kf_aviso_ins after insert on public.produtos
  referencing new table as novas
  for each statement execute function public.kf_produtos_aviso_ins();
drop trigger if exists kf_aviso_conf on public.conferencias;
create trigger kf_aviso_conf after insert on public.conferencias
  referencing new table as novas
  for each statement execute function public.kf_conferencia_aviso();

select 'Avisos por e-mail instalados. Destino: ' || coalesce((select email from public.kf_avisos), '(falta definir)') as resultado;
