-- Estoque KF versão 0.3: fornecedor e categoria nos produtos
-- Pode rodar de novo sem problema.
alter table public.produtos add column if not exists fornecedor text;
alter table public.produtos add column if not exists categoria  text;

-- categorias da lista em papel (INSUMOS e ALEGRA)
update public.produtos set categoria = 'Alegra', atualizado_em = now(), atualizado_por = 'Lista inicial'
 where categoria is null and criado_por = 'Lista inicial' and nome in (
  'ÁCIDO TRANEXÂMICO','DEOSIL','POMADA DIPROGENTA','DIPIRONA 1G','DEXAMETASONA 4ML',
  'POMADA ANESTÉSICA (ALEGRA)','HIALURONIDASE','TYLEX','DIPROSPAN');
update public.produtos set categoria = 'Insumos', atualizado_em = now(), atualizado_por = 'Lista inicial'
 where categoria is null and criado_por = 'Lista inicial';

-- fornecedores lidos com segurança na foto da lista (os duvidosos ficam em branco)
update public.produtos p set fornecedor = f.fornecedor, atualizado_em = now(), atualizado_por = 'Lista inicial'
from (values
  ('ANESTÉSICO XILESTESIN C/ VASO','Cremer'), ('CAMPO DE MESA DESCARTÁVEL BRANCO','Cremer'),
  ('CÂNULA 22G C/ AGULHA 22G','Cremer'), ('DEMAQUILANTE LENÇO','Cremer'),
  ('FIO NICROLYLON 2.0 - LIFTING','Cremer'), ('GORRO','Cremer'), ('HIDRATANTE LABIAL - POTENZA','Cremer'),
  ('KIT CIRÚRGICO PERIO','Cremer'), ('MÁSCARA','Cremer'), ('PAPEL GRAU 5CM','Cremer'),
  ('SACO PARA LIXO CONTAMINADO','Cremer'), ('SERINGA 3ML COM LUER LOCK E AGULHA 22G','Cremer'),
  ('SERINGA 5ML COM LUER LOCK','Cremer'),
  ('ANESTÉSICO XILESTESIN S/ VASO','Mercado Livre'), ('CAIXA PERFURO CORTANTE','Mercado Livre'),
  ('COTONETE','Mercado Livre'), ('FLACONETE SORO FISIOLÓGICO ESTÉRIL 10ML','Mercado Livre'),
  ('GAZE ESTÉRIL C/ 10 UNIDADES','Mercado Livre'), ('TORNEIRINHA','Mercado Livre'),
  ('DEMAQUILANTE LÍQUIDO','Farmácia'), ('DISCO DE ALGODÃO','Farmácia'),
  ('DEOSIL','Farmácia'), ('POMADA DIPROGENTA','Farmácia'),
  ('LÂMINA BISTURI N 11','Mercado Livre / Cremer'), ('LUVA CIRÚRGICA 6.5','Mercado Livre / Cremer'),
  ('LUVA XP','Mercado Livre / Cremer'), ('SERINGA 100U 30G COM AGULHA SEPARADA','Mercado Livre / Cremer')
) as f(nome, fornecedor)
where p.nome = f.nome and p.fornecedor is null;

select categoria, count(*) as produtos, count(fornecedor) as com_fornecedor
from public.produtos where not excluido group by categoria order by categoria;
