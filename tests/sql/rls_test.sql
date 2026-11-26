\set ON_ERROR_STOP 1
\set DONO '''00000000-0000-0000-0000-00000000000a'''
\set FUNC '''00000000-0000-0000-0000-00000000000b'''
\set INTR '''00000000-0000-0000-0000-00000000000c'''
create or replace function pg_temp.esperar_erro(sql text, trecho text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if position(trecho in sqlerrm) = 0 then raise exception 'erro diferente: % (esperado %)', sqlerrm, trecho; end if;
    raise notice 'OK (bloqueado): %', trecho; return;
  end;
  raise exception 'deveria ter falhado: %', sql;
end $$;
grant execute on function pg_temp.esperar_erro(text, text) to authenticated;

-- dono entra primeiro
set role authenticated;
select set_config('request.jwt.claim.sub', :DONO, false);
select papel = 'dono' as dono_ok from public.kf_entrar('Carlos');
select count(*) = 1 as dono_ve_config from public.config;
-- intruso tenta entrar sem código
select set_config('request.jwt.claim.sub', :INTR, false);
select pg_temp.esperar_erro($$select public.kf_entrar('Zé', 'ERRADO')$$, 'Código da clínica inválido');
select pg_temp.esperar_erro($$select public.kf_entrar('Zé')$$, 'Código da clínica inválido');
-- intruso não vê nada e não grava nada
select count(*) = 0 as intruso_nao_ve_config from public.config;
select count(*) = 0 as intruso_nao_ve_membros from public.membros;
select pg_temp.esperar_erro($$insert into public.produtos(id,nome,quantidade,minimo,criado_em,atualizado_em) values (gen_random_uuid(),'x',1,1,now(),now())$$, 'row-level security');
-- funcionário entra com o código
reset role;
select codigo_convite as cod from public.config \gset
set role authenticated;
select set_config('request.jwt.claim.sub', :FUNC, false);
select papel = 'funcionario' as func_ok from public.kf_entrar('Bruna', lower(:'cod'));
-- entrar de novo não muda nada
select papel = 'funcionario' as idempotente from public.kf_entrar('Outro nome', null);
-- funcionário grava produto e conferência
insert into public.produtos(id,nome,quantidade,minimo,criado_em,atualizado_em,atualizado_por)
  values ('11111111-1111-1111-1111-111111111111','Luva',10,4,'2026-11-26T10:00Z','2026-11-26T10:00Z','Bruna');
insert into public.conferencias(id,dia,feita_em,por_nome,por_papel,itens)
  values (gen_random_uuid(),'2026-11-28','2026-11-28T11:00Z','Bruna','funcionario','[]');
select por_user = :FUNC::uuid as por_user_automatico from public.conferencias;
-- não pode gravar conferência em nome de outro
select pg_temp.esperar_erro(format($$insert into public.conferencias(id,dia,feita_em,por_nome,por_papel,itens,por_user) values (gen_random_uuid(),'2026-11-28',now(),'X','dono','[]',%L)$$, :DONO), 'row-level security');
-- não pode apagar conferência (nem produto)
select pg_temp.esperar_erro($$delete from public.conferencias$$, 'permission denied');
select pg_temp.esperar_erro($$delete from public.produtos$$, 'permission denied');
-- funcionário não muda a configuração (update não afeta linha)
update public.config set prazo = '09:00'; select prazo = '18:00' as func_nao_muda_config from public.config;
select pg_temp.esperar_erro($$select public.kf_novo_codigo()$$, 'Só o dono');
-- última alteração vence: alteração mais antiga é ignorada
update public.produtos set quantidade = 99, atualizado_em = '2026-11-26T09:00Z';
select quantidade = 10 as antiga_ignorada from public.produtos;
update public.produtos set quantidade = 7, atualizado_em = '2026-11-26T11:00Z';
select quantidade = 7 as nova_aplicada from public.produtos;
-- upsert do jeito que o app faz
insert into public.produtos(id,nome,quantidade,minimo,criado_em,atualizado_em)
  values ('11111111-1111-1111-1111-111111111111','Luva',3,4,'2026-11-26T10:00Z','2026-11-26T12:00Z')
  on conflict (id) do update set quantidade = excluded.quantidade, atualizado_em = excluded.atualizado_em;
select quantidade = 3 as upsert_ok from public.produtos;
-- fornecedor e categoria (versão 0.3)
update public.produtos set fornecedor = 'Cremer', categoria = 'Insumos', atualizado_em = '2026-11-26T13:00Z';
select fornecedor = 'Cremer' and categoria = 'Insumos' as fornecedor_ok from public.produtos;
-- versão 0.7: preço, código de barras, lotes, movimentos e pedidos
update public.produtos set preco = 12.5, codigo_barras = '7891234567890', lotes = '[{"id":"l1","validade":"2027-01-10","qtd":2}]', atualizado_em = '2026-11-26T14:00Z';
select preco = 12.5 and lotes->0->>'validade' = '2027-01-10' as preco_lotes_ok from public.produtos;
insert into public.movimentos(id,produto_id,produto,tipo,delta,antes,depois,preco,por_nome,feito_em)
  values (gen_random_uuid(),'11111111-1111-1111-1111-111111111111','Luva','saida',-1,3,2,12.5,'Bruna',now());
select por_user = :FUNC::uuid as mov_por_user from public.movimentos;
select pg_temp.esperar_erro($$insert into public.movimentos(id,produto_id,produto,tipo,delta,antes,depois,por_nome,feito_em) values (gen_random_uuid(),gen_random_uuid(),'x','roubo',-1,1,0,'B',now())$$, 'check');
select pg_temp.esperar_erro($$update public.movimentos set delta = 5$$, 'permission denied');
select pg_temp.esperar_erro($$delete from public.movimentos$$, 'permission denied');
insert into public.pedidos(id,fornecedor,itens,status,criado_em,criado_por,atualizado_em)
  values ('22222222-2222-2222-2222-222222222222','Cremer','[{"nome":"Luva","qtd":5}]','feito','2026-11-26T10:00Z','Bruna','2026-11-26T10:00Z');
update public.pedidos set status = 'cancelado', atualizado_em = '2026-11-26T09:00Z';
select status = 'feito' as pedido_antigo_ignorado from public.pedidos;
update public.pedidos set status = 'recebido', recebido_em = now(), atualizado_em = '2026-11-26T11:00Z';
select status = 'recebido' as pedido_recebido from public.pedidos;
-- fotos
insert into storage.objects(bucket_id, name) values ('fotos', 'a/b.jpg');
select pg_temp.esperar_erro($$insert into storage.objects(bucket_id, name) values ('outro', 'a')$$, 'row-level security');
-- dono muda config e gera código novo
select set_config('request.jwt.claim.sub', :DONO, false);
update public.config set prazo = '12:00', inicio = '2026-11-26'; select prazo = '12:00' as dono_muda_config from public.config;
select public.kf_novo_codigo() <> :'cod' as codigo_novo;
select pg_temp.esperar_erro(format($$select public.kf_remover_membro(%L)$$, :DONO), 'não pode remover a si mesmo');
select public.kf_remover_membro(:FUNC); select count(*) = 1 as func_removido from public.membros;
-- removido perde acesso
select set_config('request.jwt.claim.sub', :FUNC, false);
select count(*) = 0 as removido_sem_acesso from public.produtos;
select count(*) = 0 as removido_sem_movimentos from public.movimentos;
-- anônimo não vê nada
reset role; set role anon;
select pg_temp.esperar_erro($$select * from public.produtos$$, 'permission denied');
reset role;
select count(*) = 5 as realtime_tabelas from pg_publication_tables where pubname = 'supabase_realtime';
