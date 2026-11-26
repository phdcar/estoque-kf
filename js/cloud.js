// Sincronização com o Supabase.
// O app continua funcionando só com os dados do celular (IndexedDB); este módulo
// envia o que mudou aqui e baixa o que mudou nos outros celulares.
// Regra de conflito: no produto, vence a alteração mais recente (atualizado_em).
import { db } from './db.js';
import { CONFIG } from './config.js';

let client = null;
const listeners = new Set();
export const state = { status: 'idle', pending: 0, lastOk: null, error: null };

function emit(changed = false) { listeners.forEach(fn => fn({ ...state }, changed)); }
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function configured() { return !!(CONFIG.url && CONFIG.key && window.supabase); }

export function sb() {
  if (!client && configured()) {
    client = window.supabase.createClient(CONFIG.url, CONFIG.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'kf-estoque-auth' },
    });
  }
  return client;
}

const msg = e => {
  const m = e?.message || String(e);
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/already registered|already been registered/i.test(m)) return 'Já existe uma conta com esse e-mail. Use "Entrar".';
  if (/Password should be at least/i.test(m)) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (/Unable to validate email|invalid format|Email address .* is invalid/i.test(m)) return 'E-mail inválido.';
  if (/Email not confirmed/i.test(m)) return 'Confirme o e-mail (veja sua caixa de entrada) e tente de novo.';
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return 'Sem conexão com a internet.';
  if (/rate limit/i.test(m)) return 'Muitas tentativas. Espere alguns minutos e tente de novo.';
  return m;
};
export const errorText = msg;

// ---------- conta ----------
export async function signIn(email, password) {
  const { error } = await sb().auth.signInWithPassword({ email, password });
  if (error) throw new Error(msg(error));
}

export async function signUp(email, password, name) {
  const { data, error } = await sb().auth.signUp({ email, password, options: { data: { nome: name } } });
  if (error) throw new Error(msg(error));
  return { needsConfirm: !data.session };
}

// Retorna { nome, papel, user_id } se a pessoa já faz parte da clínica, senão null.
export async function myMembership() {
  const { data: { user } } = await sb().auth.getUser();
  if (!user) return null;
  const { data, error } = await sb().from('membros').select('*').eq('user_id', user.id).maybeSingle();
  if (error) throw new Error(msg(error));
  return data ? { ...data, email: user.email } : null;
}

export async function join(name, code) {
  const { data, error } = await sb().rpc('kf_entrar', { p_nome: name, p_codigo: code || null });
  if (error) throw new Error(msg(error));
  const { data: { user } } = await sb().auth.getUser();
  return { ...data, email: user?.email };
}

export async function signOut() {
  stopAuto();
  try { await sb().auth.signOut(); } catch { /* sem internet: apaga a sessão local mesmo assim */ }
  try { localStorage.removeItem('kf-estoque-auth'); } catch { /* ignore */ }
}

export async function members() {
  const { data, error } = await sb().from('membros').select('*').order('criado_em');
  if (error) throw new Error(msg(error));
  return data;
}
export async function newCode() {
  const { data, error } = await sb().rpc('kf_novo_codigo');
  if (error) throw new Error(msg(error));
  await db.put('settings', { ...(await db.get('settings', 'schedule')), code: data }, 'schedule');
  return data;
}
export async function removeMember(userId) {
  const { error } = await sb().rpc('kf_remover_membro', { p_user: userId });
  if (error) throw new Error(msg(error));
}

// ---------- conversões ----------
const toRemoteProduct = p => ({
  id: p.id, nome: p.name, quantidade: p.quantity, minimo: p.min, ideal: Number(p.ideal) >= 1 ? Number(p.ideal) : null, foto_chave: p.photoKey || null,
  fornecedor: p.supplier || null, categoria: p.category || null, validade: /^\d{4}-/.test(p.expiry || '') ? p.expiry : null, sem_validade: p.expiry === 'ND',
  criado_em: p.createdAt, criado_por: p.createdBy || null, atualizado_em: p.updatedAt,
  atualizado_por: p.updatedBy || null, excluido: !!p.deleted,
  preco: p.price != null && p.price !== '' ? Number(p.price) : null, codigo_barras: p.barcode || null, lotes: (p.lots || []).map(l => ({ id: l.id, validade: l.expiry, qtd: Number(l.qty) })),
});
const fromRemoteProduct = r => ({
  id: r.id, name: r.nome, quantity: r.quantidade, min: r.minimo, ideal: r.ideal ?? null, photoKey: r.foto_chave || null,
  supplier: r.fornecedor || '', category: r.categoria || '', expiry: r.sem_validade ? 'ND' : (r.validade ? String(r.validade).slice(0, 10) : ''),
  createdAt: new Date(r.criado_em).toISOString(), createdBy: r.criado_por,
  updatedAt: new Date(r.atualizado_em).toISOString(), updatedBy: r.atualizado_por, deleted: r.excluido,
  price: r.preco != null ? Number(r.preco) : null, barcode: r.codigo_barras || '', lots: Array.isArray(r.lotes) ? r.lotes.map(l => ({ id: l.id, expiry: String(l.validade).slice(0, 10), qty: Number(l.qtd) })) : [],
});
const toRemoteMove = m => ({
  id: m.id, produto_id: m.productId, produto: m.name, tipo: m.type, delta: m.delta, antes: m.before, depois: m.after,
  preco: m.price ?? null, fornecedor: m.supplier || null, pedido_id: m.orderId || null, obs: m.note || null, por_nome: m.by, feito_em: m.at,
});
const fromRemoteMove = r => ({
  id: r.id, productId: r.produto_id, name: r.produto, type: r.tipo, delta: r.delta, before: r.antes, after: r.depois,
  price: r.preco != null ? Number(r.preco) : null, supplier: r.fornecedor || '', orderId: r.pedido_id || null, note: r.obs || '', by: r.por_nome,
  at: new Date(r.feito_em).toISOString(),
});
const toRemoteOrder = o => ({
  id: o.id, fornecedor: o.supplier, itens: (o.items || []).map(i => ({ id: i.id, nome: i.name, qtd: i.qty, preco: i.price ?? null, recebido: i.received ?? null })), status: o.status, criado_em: o.createdAt, criado_por: o.createdBy || null,
  recebido_em: o.receivedAt || null, recebido_por: o.receivedBy || null, atualizado_em: o.updatedAt,
});
const fromRemoteOrder = r => ({
  id: r.id, supplier: r.fornecedor, items: (r.itens || []).map(i => ({ id: i.id, name: i.nome, qty: i.qtd, price: i.preco ?? null, received: i.recebido ?? undefined })), status: r.status, createdAt: new Date(r.criado_em).toISOString(), createdBy: r.criado_por,
  receivedAt: r.recebido_em ? new Date(r.recebido_em).toISOString() : null, receivedBy: r.recebido_por, updatedAt: new Date(r.atualizado_em).toISOString(),
});
const toRemoteCount = c => ({
  id: c.id, dia: c.date, feita_em: c.at, por_nome: c.by, por_papel: c.role, itens: c.items || [],
  justificativa: c.justification || null, dias: c.days || null,
});
const fromRemoteCount = r => ({
  id: r.id, date: r.dia, at: new Date(r.feita_em).toISOString(), by: r.por_nome, role: r.por_papel, items: r.itens || [],
  justification: r.justificativa || null, days: r.dias || null,
});
const photoPath = (id, key, kind) => `${id}/${key}-${kind === 'original' ? 'original.jpg' : 'traco.png'}`;

// ---------- sincronização ----------
let running = null;
let again = false;

export async function countPending() {
  const ps = await db.all('products');
  const cs = await db.all('counts');
  const cfg = await db.get('settings', 'scheduleDirty');
  const os = await db.all('orders');
  // movimentos vão junto com o produto (não contam como pendência à parte)
  const ms = (await db.all('moves')).filter(m => m._dirty && !ps.some(p => p.id === m.productId && p._dirty));
  return ps.filter(p => p._dirty || p._photoDirty).length + cs.filter(c => c._dirty).length + (cfg ? 1 : 0)
    + ms.length + os.filter(o => o._dirty).length;
}

export function requestSync() {
  if (running) { again = true; return running; }
  running = (async () => {
    let changed = false;
    try {
      do { again = false; changed = (await syncOnce()) || changed; } while (again);
    } finally {
      running = null;
      emit(changed);
    }
    return changed;
  })();
  return running;
}

async function syncOnce() {
  state.pending = await countPending();
  if (!configured()) return false;
  const { data: { session } } = await sb().auth.getSession();
  if (!session) { state.status = 'logged-out'; return false; }
  if (!navigator.onLine) { state.status = 'offline'; return false; }
  state.status = 'syncing'; emit();
  let changed = false;
  try {
    // 1) confere se a pessoa ainda tem acesso (o dono pode ter retirado)
    const { data: me, error: meErr } = await sb().from('membros').select('user_id').eq('user_id', session.user.id).maybeSingle();
    if (meErr) throw meErr;
    if (!me) { state.status = 'removed'; return false; }
    // 2) envia (o servidor ignora alteração de produto mais antiga que a dele)
    await pushConfig();
    await pushProducts();
    await pushCounts();
    await pushMoves();
    await pushOrders();
    // 3) baixa o que mudou
    changed = (await pullConfig()) || changed;
    changed = (await pullProducts()) || changed;
    changed = (await pullCounts()) || changed;
    changed = (await pullMoves()) || changed;
    changed = (await pullOrders()) || changed;
    changed = (await downloadPhotos()) || changed;
    state.status = 'ok';
    state.error = null;
    state.lastOk = new Date().toISOString();
  } catch (e) {
    console.warn('sync', e);
    state.status = navigator.onLine ? 'error' : 'offline';
    state.error = msg(e);
  }
  state.pending = await countPending();
  return changed;
}

async function pushConfig() {
  if (!(await db.get('settings', 'scheduleDirty'))) return;
  const s = await db.get('settings', 'schedule');
  const { error } = await sb().from('config').update({ inicio: s.startDate, prazo: s.deadline, atualizado_em: new Date().toISOString() }).eq('id', 1);
  if (error) throw error;
  await db.del('settings', 'scheduleDirty');
}

async function pullConfig() {
  const { data, error } = await sb().from('config').select('*').eq('id', 1).maybeSingle();
  if (error) throw error;
  if (!data) return false;
  if (await db.get('settings', 'scheduleDirty')) return false; // alteração local ainda não enviada
  const old = await db.get('settings', 'schedule');
  const next = { startDate: data.inicio, deadline: data.prazo, code: data.codigo_convite };
  if (old && old.startDate === next.startDate && old.deadline === next.deadline && old.code === next.code) return false;
  await db.put('settings', next, 'schedule');
  return true;
}

async function pushProducts() {
  const dirty = (await db.all('products')).filter(p => p._dirty || p._photoDirty);
  for (const p of dirty) {
    if (p._photoDirty && p.photoKey) {
      const ph = await db.get('photos', p.id);
      if (ph) {
        for (const kind of ['original', 'lineart']) {
          const blob = kind === 'original' ? ph.original : ph.lineart;
          const { error } = await sb().storage.from('fotos').upload(photoPath(p.id, p.photoKey, kind), blob,
            { upsert: true, contentType: blob.type || (kind === 'original' ? 'image/jpeg' : 'image/png') });
          if (error) throw error;
        }
      }
    }
    const { error } = await sb().from('produtos').upsert(toRemoteProduct(p), { onConflict: 'id' });
    if (error) throw error;
    // só limpa a marca se ninguém mexeu no produto enquanto enviava
    const cur = await db.get('products', p.id);
    if (cur && cur.updatedAt === p.updatedAt && cur.photoKey === p.photoKey) {
      delete cur._dirty; delete cur._photoDirty;
      await db.put('products', cur);
    }
  }
}

async function pushCounts() {
  const dirty = (await db.all('counts')).filter(c => c._dirty);
  if (!dirty.length) return;
  const { error } = await sb().from('conferencias').upsert(dirty.map(toRemoteCount), { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw error;
  for (const c of dirty) { delete c._dirty; await db.put('counts', c); }
}

async function pushMoves() {
  const dirty = (await db.all('moves')).filter(m => m._dirty);
  if (!dirty.length) return;
  const { error } = await sb().from('movimentos').upsert(dirty.map(toRemoteMove), { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw error;
  for (const m of dirty) { delete m._dirty; await db.put('moves', m); }
}

async function pushOrders() {
  const dirty = (await db.all('orders')).filter(o => o._dirty);
  for (const o of dirty) {
    const { error } = await sb().from('pedidos').upsert(toRemoteOrder(o), { onConflict: 'id' });
    if (error) throw error;
    const cur = await db.get('orders', o.id);
    if (cur && cur.updatedAt === o.updatedAt) { delete cur._dirty; await db.put('orders', cur); }
  }
}

async function pullMoves() {
  const rows = await pullTable('movimentos', 'pull-movimentos');
  let changed = false;
  for (const r of rows) {
    if (await db.get('moves', r.id)) continue;
    await db.put('moves', fromRemoteMove(r));
    changed = true;
  }
  return changed;
}

async function pullOrders() {
  const rows = await pullTable('pedidos', 'pull-pedidos');
  let changed = false;
  for (const r of rows) {
    const remote = fromRemoteOrder(r);
    const local = await db.get('orders', r.id);
    if (local && local._dirty && Date.parse(local.updatedAt) > Date.parse(remote.updatedAt)) continue;
    if (local && local.updatedAt === remote.updatedAt && local.status === remote.status) continue;
    await db.put('orders', remote);
    changed = true;
  }
  return changed;
}

// Baixa linhas alteradas desde a última vez (com 2 min de folga para não perder nada).
async function pullTable(table, key) {
  const since = await db.get('settings', key);
  let q = sb().from(table).select('*').order('servidor_em', { ascending: true }).limit(1000);
  if (since) q = q.gt('servidor_em', new Date(Date.parse(since) - 120000).toISOString());
  const { data, error } = await q;
  if (error) throw error;
  if (data.length) await db.put('settings', data[data.length - 1].servidor_em, key);
  return data;
}

async function pullProducts() {
  const rows = await pullTable('produtos', 'pull-produtos');
  let changed = false;
  for (const r of rows) {
    const remote = fromRemoteProduct(r);
    const local = await db.get('products', r.id);
    if (local && (local._dirty || local._photoDirty) && Date.parse(local.updatedAt) > Date.parse(remote.updatedAt)) continue;
    if (local && local.updatedAt === remote.updatedAt && local.name === remote.name && local.quantity === remote.quantity &&
        local.min === remote.min && local.photoKey === remote.photoKey && !!local.deleted === !!remote.deleted) continue;
    await db.put('products', remote);
    if (remote.deleted) await db.del('photos', r.id);
    changed = true;
  }
  return changed;
}

async function pullCounts() {
  const rows = await pullTable('conferencias', 'pull-conferencias');
  let changed = false;
  for (const r of rows) {
    if (await db.get('counts', r.id)) continue;
    await db.put('counts', fromRemoteCount(r));
    changed = true;
  }
  return changed;
}

async function downloadPhotos() {
  const ps = (await db.all('products')).filter(p => !p.deleted && p.photoKey && !p._photoDirty);
  let changed = false;
  for (const p of ps) {
    const ph = await db.get('photos', p.id);
    if (ph && ph.key === p.photoKey) continue;
    const get = async kind => {
      const { data, error } = await sb().storage.from('fotos').download(photoPath(p.id, p.photoKey, kind));
      if (error) throw error;
      return data;
    };
    try {
      const [original, lineart] = await Promise.all([get('original'), get('lineart')]);
      await db.put('photos', { id: p.id, original, lineart, key: p.photoKey });
      changed = true;
    } catch (e) {
      console.warn('foto', p.id, e); // tenta de novo na próxima sincronização
    }
  }
  return changed;
}

// ---------- automático ----------
let timer = null;
let channel = null;
let debounce = null;

export function syncSoon() {
  clearTimeout(debounce);
  debounce = setTimeout(() => requestSync(), 400);
}

export function startAuto() {
  if (!configured() || timer) return;
  requestSync();
  timer = setInterval(() => { if (!document.hidden) requestSync(); }, CONFIG.pollSeconds * 1000);
  window.addEventListener('online', syncSoon);
  window.addEventListener('offline', () => { state.status = 'offline'; emit(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncSoon(); });
  if (CONFIG.realtime) {
    try {
      channel = sb().channel('kf-estoque');
      for (const table of ['produtos', 'conferencias', 'config', 'movimentos', 'pedidos']) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table }, syncSoon);
      }
      channel.subscribe();
    } catch (e) { console.warn('realtime', e); }
  }
}

export function stopAuto() {
  clearInterval(timer); timer = null;
  if (channel) { try { sb().removeChannel(channel); } catch { /* ignore */ } channel = null; }
}

// ---------- notificações push (etapa 3) ----------
const pushFn = body => fetch(`${CONFIG.url}/functions/v1/kf-push`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CONFIG.key }, body: JSON.stringify(body),
}).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.erro || `HTTP ${r.status}`); return j; });
export async function pushKey() { return (await pushFn({ acao: 'chave' })).chave; }
export async function pushSave(sub) {
  const j = sub.toJSON();
  const { error } = await sb().from('kf_push_inscricoes').upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: 'endpoint' });
  if (error) throw new Error(msg(error));
}
export async function pushTest(endpoint, badge) { return pushFn({ acao: 'teste', endpoint, badge }); }

// ---------- relatório mensal em PDF (versão 0.7) ----------
async function reportFn(body) {
  const { data: { session } } = await sb().auth.getSession();
  if (!session) throw new Error('Entre na conta primeiro.');
  const r = await fetch(`${CONFIG.url}/functions/v1/kf-relatorio`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CONFIG.key, 'x-kf-token': session.access_token }, body: JSON.stringify(body),
  });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.erro || `HTTP ${r.status}`); }
  return r;
}
export async function reportPdf(month) { return (await reportFn({ acao: 'baixar', mes: month })).blob(); }
export async function reportEmail(month) { return (await reportFn({ acao: 'email', mes: month })).json(); }
