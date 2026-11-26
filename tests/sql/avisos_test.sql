\set ON_ERROR_STOP 1
\set DONO '''00000000-0000-0000-0000-00000000000a'''
create or replace function pg_temp.esperar_erro(sql text, trecho text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if position(trecho in sqlerrm) = 0 then raise exception 'erro diferente: % (esperado %)', sqlerrm, trecho; end if;
    raise notice 'OK (bloqueado): %', trecho; return;
  end;
  raise exception 'deveria ter falhado: %', sql;
end $$;
grant execute on function pg_temp.esperar_erro(text, text) to authenticated;
update public.kf_avisos set email = 'dono@teste.kf';
-- sem a chave: não envia, registra o motivo, e o estoque é salvo normalmente
set role authenticated;
select set_config('request.jwt.claim.sub', :DONO, false);
insert into public.produtos(id,nome,quantidade,minimo,criado_em,atualizado_em,atualizado_por)
  values ('22222222-0000-0000-0000-000000000001','Agulha 31G',10,5,now(),'2026-11-27T10:00Z','Carlos');
reset role;
select (select count(*) from net.chamadas) = 0 as sem_chave_nao_envia;
select (select erro from public.kf_avisos_log order by id desc limit 1) like 'falta o segredo%' as sem_chave_registra;
select (select count(*) from public.produtos where nome = 'Agulha 31G') = 1 as sem_chave_salva;
insert into vault.decrypted_secrets values ('resend_api_key', 're_teste');
-- envio do app com 3 produtos novos de uma vez = 1 e-mail
set role authenticated;
select set_config('request.jwt.claim.sub', :DONO, false);
insert into public.produtos(id,nome,quantidade,minimo,criado_em,atualizado_em,atualizado_por,fornecedor) values
  ('22222222-0000-0000-0000-000000000002','Gaze',3,10,now(),'2026-11-27T10:00Z','Bruna','Cremer'),
  ('22222222-0000-0000-0000-000000000003','Luva XP',8,4,now(),'2026-11-27T10:00Z','Bruna','Cremer'),
  ('22222222-0000-0000-0000-000000000004','Cotonete',1,1,now(),'2026-11-27T10:00Z','Bruna',null)
  on conflict (id) do update set quantidade = excluded.quantidade, atualizado_em = excluded.atualizado_em;
reset role;
select count(*) = 1 as tres_novos_um_email from net.chamadas;
select body->>'subject' = 'Estoque KF · 3 produtos alterados (Bruna) · 1 abaixo do mínimo' as assunto_novos,
       body->'to'->>0 = 'dono@teste.kf' as destino_ok, headers->>'Authorization' = 'Bearer re_teste' as chave_ok,
       url = 'https://api.resend.com/emails' as url_ok
  from net.chamadas order by id desc limit 1;
-- quantidade baixou e ficou abaixo do mínimo
set role authenticated;
select set_config('request.jwt.claim.sub', :DONO, false);
update public.produtos set quantidade = 4, atualizado_em = '2026-11-27T11:00Z', atualizado_por = 'Bruna' where nome = 'Agulha 31G';
reset role;
select body->>'subject' = 'Estoque KF · Agulha 31G: 10 → 4 (Bruna) · 1 abaixo do mínimo' as assunto_baixou,
       position('ABAIXO DO MÍNIMO' in body->>'html') > 0 as html_marca_vermelho
  from net.chamadas order by id desc limit 1;
select count(*) = 2 as dois_emails_ate_aqui from net.chamadas;
-- alteração antiga (ignorada pela regra "a mais recente vence") não gera e-mail
set role authenticated;
select set_config('request.jwt.claim.sub', :DONO, false);
update public.produtos set quantidade = 99, atualizado_em = '2026-11-27T09:00Z' where nome = 'Agulha 31G';
-- só a data mudou (nada no estoque): sem e-mail
update public.produtos set atualizado_em = '2026-11-27T12:00Z' where nome = 'Luva XP';
reset role;
select count(*) = 2 as sem_email_sem_mudanca from net.chamadas;
-- conferência mexe em vários produtos num envio só: 1 e-mail de produtos + 1 da conferência
set role authenticated;
select set_config('request.jwt.claim.sub', :DONO, false);
insert into public.produtos(id,nome,quantidade,minimo,criado_em,atualizado_em,atualizado_por) values
  ('22222222-0000-0000-0000-000000000002','Gaze',12,10,now(),'2026-11-27T13:00Z','Bruna'),
  ('22222222-0000-0000-0000-000000000003','Luva XP',8,4,now(),'2026-11-27T13:00Z','Bruna'),
  ('22222222-0000-0000-0000-000000000004','Cotonete',0,1,now(),'2026-11-27T13:00Z','Bruna')
  on conflict (id) do update set quantidade = excluded.quantidade, atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por;
insert into public.conferencias(id, dia, feita_em, por_nome, por_papel, por_user, itens) values
  (gen_random_uuid(), '2026-11-27', '2026-11-27T13:00Z', 'Bruna', 'funcionario', :DONO,
   '[{"name":"Gaze","before":3,"counted":12},{"name":"Luva XP","before":8,"counted":8},{"name":"Cotonete","before":1,"counted":0}]');
reset role;
select count(*) = 4 as conferencia_dois_emails from net.chamadas;
select (select body->>'subject' from net.chamadas where id = (select max(id) - 1 from net.chamadas))
       = 'Estoque KF · 2 produtos alterados (Bruna) · 1 abaixo do mínimo' as assunto_conferencia_produtos;
select body->>'subject' = 'Estoque KF · Conferência feita por Bruna (3 produtos, 2 com diferença)' as assunto_conferencia
  from net.chamadas order by id desc limit 1;
-- exclusão
set role authenticated;
select set_config('request.jwt.claim.sub', :DONO, false);
update public.produtos set excluido = true, atualizado_em = '2026-11-27T14:00Z', atualizado_por = 'Carlos' where nome = 'Luva XP';
reset role;
select body->>'subject' = 'Estoque KF · Luva XP: excluído (Carlos)' as assunto_excluido from net.chamadas order by id desc limit 1;
-- o app não enxerga a configuração nem o registro
set role authenticated;
select pg_temp.esperar_erro($$select * from public.kf_avisos$$, 'permission denied');
select pg_temp.esperar_erro($$select public.kf_enviar_email('x','y')$$, 'permission denied');
reset role;
-- desligado: não envia
update public.kf_avisos set ligado = false;
set role authenticated;
select set_config('request.jwt.claim.sub', :DONO, false);
update public.produtos set quantidade = 7, atualizado_em = '2026-11-27T15:00Z' where nome = 'Gaze';
reset role;
select count(*) = 5 as desligado_nao_envia from net.chamadas;
-- validade (versão 0.4)
update public.kf_avisos set ligado = true;
set role authenticated;
select set_config('request.jwt.claim.sub', :DONO, false);
update public.produtos set validade = '2027-03-05', atualizado_em = '2026-11-27T16:00Z', atualizado_por = 'Carlos' where nome = 'Gaze';
reset role;
select body->>'html' like '%validade: 05/03/2027%' as email_mostra_validade from net.chamadas order by id desc limit 1;
set role authenticated;
select set_config('request.jwt.claim.sub', :DONO, false);
update public.produtos set sem_validade = true, validade = null, atualizado_em = '2026-11-27T16:10Z' where nome = 'Gaze';
reset role;
select body->>'html' like '%validade: ND (sem validade)%' as email_mostra_nd from net.chamadas order by id desc limit 1;
-- aviso diário: só nos marcos (30, 7, 1, 0 dias, venceu ontem)
update public.produtos set validade = (now() at time zone 'America/Sao_Paulo')::date + 12, sem_validade = false where nome = 'Cotonete';
select public.kf_aviso_validade();
select count(*) = 0 as validade_fora_do_marco_nao_envia from net.chamadas where body->>'subject' like 'Estoque KF · Validade%';
update public.produtos set validade = (now() at time zone 'America/Sao_Paulo')::date + 7 where nome = 'Cotonete';
select public.kf_aviso_validade();
select count(*) = 1 as validade_no_marco_envia from net.chamadas where body->>'subject' like 'Estoque KF · Validade%';
select body->>'subject' = 'Estoque KF · Validade: 1 produto(s) chegando ao prazo' and body->>'html' like '%vence em 7 dia(s)%' as assunto_validade
  from net.chamadas order by id desc limit 1;
-- justificativa (versão 0.5)
set role authenticated;
select set_config('request.jwt.claim.sub', :DONO, false);
insert into public.conferencias(id, dia, feita_em, por_nome, por_papel, por_user, itens, justificativa, dias) values
  (gen_random_uuid(), '2026-11-30', '2026-11-30T12:00Z', 'Bruna', 'funcionario', :DONO, '[]', 'Faltei por motivo de saúde.', '{2026-11-27}');
reset role;
select body->>'subject' = 'Estoque KF · Justificativa de Bruna: conferência não feita'
   and body->>'html' like '%27/11/2026%' and body->>'html' like '%Faltei por motivo de saúde.%' as email_justificativa
  from net.chamadas order by id desc limit 1;
set role authenticated;
select pg_temp.esperar_erro($$insert into public.conferencias(id, dia, feita_em, por_nome, por_papel, por_user, itens, justificativa) values (gen_random_uuid(), '2026-11-30', now(), 'B', 'funcionario', auth.uid(), '[]', 'curta')$$, 'check');
reset role;
