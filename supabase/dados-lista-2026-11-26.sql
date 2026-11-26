-- Lista preenchida pelo dono em 26/11/2026 (foto da folha): quantidade, ideal, alerta (= estoque mínimo) e fornecedor.
-- Correções do dono: Sabão alerta 1, Cânula ideal 50, Álcool e Cotonete Dental Cremer, Agulha 32G e Fio: Mercado Livre.
-- "Cremer" passa a se chamar "Dental Cremer" em todos os produtos.
begin;
update public.produtos set nome = 'AGULHA 32G 6MM', atualizado_em = now(), atualizado_por = 'Lista do dono' where nome = 'AGULHA 31G' and not excluido;
update public.produtos set nome = 'SERINGA 30UI 6MM X 31G', atualizado_em = now(), atualizado_por = 'Lista do dono' where nome = 'SERINGA BD 30U 6X31G E 50U' and not excluido;
update public.produtos set nome = 'SERINGA 1ML COM LUER LOCK', atualizado_em = now(), atualizado_por = 'Lista do dono' where nome = 'SERINGA 100U 30G COM AGULHA SEPARADA' and not excluido;
insert into public.produtos (id, nome, quantidade, minimo, categoria, criado_em, criado_por, atualizado_em, atualizado_por)
  select gen_random_uuid(), 'SABÃO ENZIMÁTICO', 0, 0, 'Insumos', now(), 'Lista do dono', now(), 'Lista do dono'
  where not exists (select 1 from public.produtos where nome = 'SABÃO ENZIMÁTICO' and not excluido);

update public.produtos p set quantidade = v.q, ideal = v.i, minimo = v.a, fornecedor = v.f, atualizado_em = now(), atualizado_por = 'Lista do dono'
from (values
  ('ALCOOL 70%', 3, 4, 2, 'Dental Cremer'),
  ('AGULHA 32G 6MM', 100, 100, 30, 'Mercado Livre'),
  ('AGULHA 18G', 30, 100, 30, 'Dental Cremer'),
  ('ANESTÉSICO XILESTESIN C/ VASO', 2, 10, 2, 'Mercado Livre'),
  ('ANESTÉSICO XILESTESIN S/ VASO', 1, 5, 1, 'Mercado Livre'),
  ('CAIXA PERFURO CORTANTE', 2, 2, 1, 'Dental Cremer'),
  ('CAMPO DE MESA DESCARTÁVEL BRANCO', 2, 1, 1, 'Dental Cremer'),
  ('CÂNULA 22G C/ AGULHA 22G', 20, 50, 20, 'Mercado Livre'),
  ('COTONETE', 1, 1, 1, 'Dental Cremer'),
  ('CLOREXIDINA 2% 1L - RIOHEX', 1, 1, 1, 'Dental Cremer'),
  ('DEMAQUILANTE LENÇO', 10, 10, 2, 'Farmácia'),
  ('DEMAQUILANTE LÍQUIDO', 0, 1, 1, 'Farmácia'),
  ('DISCO DE ALGODÃO', 5, 6, 2, 'Dental Cremer'),
  ('FIO NICROLYLON 2.0 - LIFTING', 9, 10, 3, 'Mercado Livre'),
  ('FLACONETE ÁGUA PARA INJEÇÃO 10ML', 100, 30, 10, 'Mercado Livre'),
  ('FLACONETE SORO FISIOLÓGICO ESTÉRIL 10ML', 6, 50, 10, 'Mercado Livre'),
  ('GAZE ESTÉRIL C/ 10 UNIDADES', 30, 100, 30, 'Dental Cremer'),
  ('GORRO', 1, 1, 1, 'Dental Cremer'),
  ('HIDRATANTE LABIAL - POTENZA', 1, 1, 1, 'Dental Cremer'),
  ('KIT CIRÚRGICO PERIO', 9, 10, 3, 'Mercado Livre / Dental Cremer'),
  ('LÂMINA BISTURI N 11', 25, 50, 10, 'Mercado Livre / Dental Cremer'),
  ('LUVA CIRÚRGICA 6.5', 25, 30, 10, 'Mercado Livre / Dental Cremer'),
  ('LUVA XP', 1, 2, 1, 'Dental Cremer'),
  ('MÁSCARA', 1, 2, 1, 'Dental Cremer'),
  ('PAPEL GRAU 5CM', 1, 1, 1, 'Dental Cremer'),
  ('PINCEL PARA GLOSS', 100, 100, 20, 'Mercado Livre'),
  ('POMADA ANESTÉSICA', 2, 2, 1, 'Farmácia de manipulação'),
  ('ROLOPACK', 1, 1, 1, 'Dental Cremer'),
  ('SACO PARA LIXO CONTAMINADO', 20, 50, 10, 'Dental Cremer'),
  ('SERINGA 3ML COM LUER LOCK E AGULHA 22G', 15, 30, 10, 'Dental Cremer'),
  ('SERINGA 5ML COM LUER LOCK', 7, 50, 10, 'Dental Cremer'),
  ('SERINGA 30UI 6MM X 31G', 20, 100, 20, 'Mercado Livre'),
  ('SERINGA 1ML COM LUER LOCK', 100, 100, 20, 'Mercado Livre / Dental Cremer'),
  ('SABÃO ENZIMÁTICO', 1, 1, 1, 'Dental Cremer'),
  ('TORNEIRINHA', 10, 20, 5, 'Mercado Livre')
) as v(n, q, i, a, f)
where p.nome = v.n and not p.excluido;
-- medicamentos: só troca o nome do fornecedor
update public.produtos set fornecedor = 'Dental Cremer', atualizado_em = now() where fornecedor = 'Cremer' and not excluido;
commit;
select count(*) filter (where categoria = 'Insumos') as insumos,
       count(*) filter (where categoria = 'Insumos' and ideal is not null) as insumos_com_numeros,
       count(*) filter (where quantidade < minimo) as abaixo_do_minimo,
       string_agg(nome, ', ') filter (where categoria = 'Insumos' and ideal is null) as faltando
from public.produtos where not excluido;
