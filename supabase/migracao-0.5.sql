-- Estoque KF versão 0.5: conferência diária de segunda a sexta, com justificativa do dia que faltar.
-- Pode rodar de novo sem problema. Depois rode de novo supabase/avisos-email.sql.
-- versão 0.5: conferência diária (segunda a sexta); dia útil sem conferência recebe justificativa
alter table public.conferencias add column if not exists justificativa text check (justificativa is null or length(trim(justificativa)) >= 10);
alter table public.conferencias add column if not exists dias date[];
