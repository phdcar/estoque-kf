\set ON_ERROR_STOP 1
-- versão 0.8: lembrete das 17h e resumo da manhã (roda depois de avisos_test.sql)
\set DONO '''00000000-0000-0000-0000-00000000000a'''
\set FUNC '''00000000-0000-0000-0000-00000000000b'''
create or replace function pg_temp.esperar_erro(sql text, trecho text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if position(trecho in sqlerrm) = 0 then raise exception 'erro diferente: % (esperado %)', sqlerrm, trecho; end if;
    raise notice 'OK (bloqueado): %', trecho; return;
  end;
  raise exception 'deveria ter falhado: %', sql;
end $$;
grant execute on function pg_temp.esperar_erro(text, text) to authenticated;
delete from net.chamadas;
update public.config set inicio = '2026-11-01', prazo = '18:00';
-- inscrição de um funcionário (se ele ainda for membro)
insert into public.kf_push_inscricoes (endpoint, p256dh, auth, user_id)
  select 'https://web.push.apple.com/func', 'BPUB2', 'AUTH2', user_id from public.membros where papel <> 'dono' limit 1;
select count(*) >= 1 as todos_inclui_dono from public.kf_push_destinos_todos() d join public.membros m using (user_id) where m.papel = 'dono';
select (select count(*) from public.kf_push_destinos_todos()) >= (select count(*) from public.kf_push_destinos()) as todos_tem_mais_ou_igual;
-- sábado: nada
select public.kf_lembrete_conferencia('2026-12-05 20:00Z') = 'hoje não é segunda-feira' as lembrete_sabado;
-- versão 0.8.3: só na segunda-feira
select public.kf_lembrete_conferencia('2026-12-08 20:00Z') = 'hoje não é segunda-feira' as lembrete_terca_nao;
-- segunda sem conferência: avisa todos
select public.kf_lembrete_conferencia('2026-12-07 20:00Z') = 'lembrete enviado' as lembrete_segunda;
select body->>'todos' = 'true' and body->>'title' = 'Conferência de segunda-feira' and body->>'body' like '%prazo é às 18h.' as lembrete_conteudo
  from net.chamadas where url like '%kf-push' order by id desc limit 1;
-- com conferência no dia: não avisa
insert into public.conferencias(id, dia, feita_em, por_nome, por_papel, por_user, itens) values
  (gen_random_uuid(), '2026-12-14', '2026-12-14T15:00Z', 'Bruna', 'funcionario', :DONO, '[]');
select public.kf_lembrete_conferencia('2026-12-14 20:00Z') = 'já conferido' as lembrete_ja_conferido;
-- justificativa no dia não conta como conferência
insert into public.conferencias(id, dia, feita_em, por_nome, por_papel, por_user, itens, justificativa, dias) values
  (gen_random_uuid(), '2026-12-21', '2026-12-21T12:00Z', 'Bruna', 'funcionario', :DONO, '[]', 'Faltei por motivo de saúde.', '{2026-12-14}');
select public.kf_lembrete_conferencia('2026-12-21 20:00Z') = 'lembrete enviado' as justificativa_nao_conta;
-- antes da data inicial: nada
update public.config set inicio = '2027-01-11';
select public.kf_lembrete_conferencia('2026-12-28 20:00Z') = 'conferência ainda não começou' as lembrete_antes_inicio;
update public.config set inicio = '2026-11-01';
-- resumo da manhã: só para o dono, com a contagem
delete from net.chamadas;
select public.kf_resumo_manha('2026-12-05 11:02Z') = 'fim de semana' as resumo_sabado;
select public.kf_resumo_manha('2026-12-07 11:02Z') like '%esgotado%' as resumo_segunda;
select coalesce(body->>'todos', 'false') = 'false' and body->>'title' = 'Bom dia · estoque' and (body->>'badge')::int >= 1 as resumo_so_dono_com_numero
  from net.chamadas where url like '%kf-push' order by id desc limit 1;
update public.produtos set quantidade = greatest(minimo, 1) + 5, sem_validade = true;
select public.kf_resumo_manha('2026-12-07 11:02Z') = 'nada a avisar' as resumo_vazio_nao_avisa;
-- funcionário não pode chamar
set role authenticated;
select pg_temp.esperar_erro($$select public.kf_lembrete_conferencia()$$, 'permission denied');
select pg_temp.esperar_erro($$select * from public.kf_push_destinos_todos()$$, 'permission denied');
reset role;
