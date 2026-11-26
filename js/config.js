// Endereço e chave PÚBLICA (anon) do Supabase. A chave anon pode ficar no app:
// quem protege os dados são as regras de acesso (RLS) do banco, em supabase/schema.sql.
export const CONFIG = Object.assign({
  url: 'https://jmaghjeoucunvidtqeke.supabase.co',
  key: '', // chave anon public — falta receber
  realtime: true,
  pollSeconds: 30,
}, window.__KF_CONFIG || {}); // os testes automáticos trocam por um servidor falso
