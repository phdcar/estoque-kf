-- Estoque KF versão 0.4: data de validade nos produtos (ou ND = sem validade)
-- Pode rodar de novo sem problema. Depois rode de novo supabase/avisos-email.sql
-- (os e-mails passam a mostrar a validade e chega um aviso diário de vencimento).
alter table public.produtos add column if not exists validade     date;
alter table public.produtos add column if not exists sem_validade boolean not null default false;
alter table public.produtos add column if not exists ideal        int check (ideal >= 0);   -- estoque ideal (compra sugerida)
select count(*) as produtos, count(validade) as com_validade, count(*) filter (where sem_validade) as nd
from public.produtos where not excluido;
