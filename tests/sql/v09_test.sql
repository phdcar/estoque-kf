\set ON_ERROR_STOP 1
-- versão 0.9: aviso ao dono quando a conferência de segunda-feira atrasa (roda depois de v08_test.sql)
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
delete from public.kf_aviso_atraso;
update public.kf_avisos set ligado = true, email = 'dono@teste.kf';
update public.config set inicio = '2026-11-01', prazo = '18:00';
update public.produtos set criado_em = '2026-11-20T12:00Z';
-- segunda 2027-01-04: antes do prazo (17h59 Brasília = 20h59 UTC) não avisa
select public.kf_aviso_atrasada('2027-01-04 20:59Z') = 'ainda no prazo' as atraso_antes_do_prazo;
-- terça: não é segunda
select public.kf_aviso_atrasada('2027-01-05 21:10Z') = 'hoje não é segunda-feira' as atraso_terca_nao;
-- segunda 18h10 Brasília sem conferência: avisa (push + e-mail)
select public.kf_aviso_atrasada('2027-01-04 21:10Z') = 'aviso enviado' as atraso_avisa;
select exists (select 1 from net.chamadas where url like '%kf-push' and body->>'body' like '%atrasada%') as atraso_push_dono;
select exists (select 1 from net.chamadas where url like '%resend%' and body->>'subject' like '%atrasada%') as atraso_email;
-- 10 minutos depois: não repete
select public.kf_aviso_atrasada('2027-01-04 21:20Z') = 'aviso já enviado hoje' as atraso_nao_repete;
-- 23h50 de segunda em Brasília (terça 02h50 UTC) ainda é segunda: continua sem repetir
select public.kf_aviso_atrasada('2027-01-05 02:50Z') = 'aviso já enviado hoje' as atraso_noite_ainda_segunda;
-- outra segunda, com conferência feita: não avisa
insert into public.conferencias(id, dia, feita_em, por_nome, por_papel, por_user, itens) values
  (gen_random_uuid(), '2027-01-11', '2027-01-11T15:00Z', 'Bruna', 'funcionario', '00000000-0000-0000-0000-00000000000a', '[]');
select public.kf_aviso_atrasada('2027-01-11 21:10Z') = 'já conferido' as atraso_ja_conferido;
-- prazo diferente (16:30) é respeitado
update public.config set prazo = '16:30';
select public.kf_aviso_atrasada('2027-01-18 19:20Z') = 'ainda no prazo' as atraso_prazo_1620;
select public.kf_aviso_atrasada('2027-01-18 19:31Z') = 'aviso enviado' as atraso_prazo_1631;
update public.config set prazo = '18:00';
-- produtos criados hoje não cobram
update public.produtos set criado_em = '2027-01-25T12:00Z';
select public.kf_aviso_atrasada('2027-01-25 21:10Z') = 'sem produtos' as atraso_produtos_novos;
update public.produtos set criado_em = '2026-11-20T12:00Z';
-- resumo dos celulares: dono vê, funcionário não
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select (select sum(celulares) from public.kf_push_resumo()) >= 1 as resumo_dono_ve;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.esperar_erro($$select * from public.kf_push_resumo()$$, 'Só o dono');
-- funcionário não pode chamar nem ler
select pg_temp.esperar_erro($$select public.kf_aviso_atrasada()$$, 'permission denied');
select pg_temp.esperar_erro($$select * from public.kf_aviso_atraso$$, 'permission denied');
reset role;
