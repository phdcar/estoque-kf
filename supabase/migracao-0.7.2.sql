-- Estoque KF versão 0.7.2: histórico de preços.
-- Cada mudança de preço vira um movimento do tipo "preco" (quantidade não muda, delta 0).
-- Pode rodar de novo sem problema.
alter table public.movimentos drop constraint if exists movimentos_tipo_check;
alter table public.movimentos add constraint movimentos_tipo_check
  check (tipo in ('entrada', 'saida', 'ajuste', 'conferencia', 'perda', 'preco'));

select 'Versão 0.7.2 instalada: histórico de preços.' as resultado;
