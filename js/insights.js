// Versão 0.7: consumo e previsão, lotes com validade, custo do estoque e texto do pedido.
// Funções puras (sem tela nem banco), testadas em tests/unit/insights.test.js.

const DAY = 864e5;
const localYmd = d => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
export const monthKey = iso => localYmd(new Date(iso)).slice(0, 7);

// ---------- consumo ----------
// Consumo = o que saiu pelo botão −, o que sumiu na conferência e ajustes para menos (perda por vencimento não conta).
export const CONSUME_TYPES = ['saida', 'conferencia', 'ajuste'];
export const MIN_HISTORY_DAYS = 7;   // menos que isso, ainda não dá para prever
export const WINDOW_DAYS = 30;

export function consumption(moves, productId, now = new Date(), windowDays = WINDOW_DAYS) {
  const mine = moves.filter(m => m.productId === productId && m.type !== 'preco');
  if (!mine.length) return { perDay: 0, used: 0, days: 0, enough: false };
  const first = Math.min(...mine.map(m => Date.parse(m.at)));
  const from = Math.max(first, now.getTime() - windowDays * DAY);
  const days = Math.max(1, (now.getTime() - from) / DAY);
  const net = mine.filter(m => CONSUME_TYPES.includes(m.type) && Date.parse(m.at) >= from).reduce((n, m) => n + m.delta, 0);
  const used = Math.max(0, -net);
  return { perDay: used / days, used, days: Math.round(days), enough: (now.getTime() - first) / DAY >= MIN_HISTORY_DAYS && used > 0 };
}

// dias até acabar no ritmo atual (null = sem consumo conhecido)
export const forecastDays = (p, c) => (c && c.enough && c.perDay > 0 ? Math.floor(Number(p.quantity) / c.perDay) : null);

// alerta = 1 semana de uso; ideal = 1 mês de uso
export function suggestLevels(c, cover = 7, target = 30) {
  if (!c || !c.enough || c.perDay <= 0) return null;
  const min = Math.max(1, Math.ceil(c.perDay * cover));
  return { min, ideal: Math.max(min + 1, Math.ceil(c.perDay * target)) };
}

export function rateText(perDay) {
  if (!(perDay > 0)) return 'Sem consumo registrado';
  const r = n => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10).toLocaleString('pt-BR');
  if (perDay >= 1) return `~${r(perDay)} por dia`;
  if (perDay * 7 >= 1) return `~${r(perDay * 7)} por semana`;
  return `~${r(perDay * 30)} por mês`;
}

export function forecastText(days) {
  if (days == null) return '';
  if (days <= 0) return 'Acaba hoje';
  if (days === 1) return 'Acaba em ~1 dia';
  if (days < 60) return `Acaba em ~${days} dias`;
  return `Dura mais de ${Math.floor(days / 30)} meses`;
}

// ---------- lotes ----------
// p.lots = [{ id, expiry: 'AAAA-MM-DD', qty }]. Uso: o que vence primeiro sai primeiro.
export const lotsTotal = p => (p.lots || []).reduce((n, l) => n + Number(l.qty || 0), 0);
export const sortedLots = p => [...(p.lots || [])].filter(l => Number(l.qty) > 0).sort((a, b) => a.expiry.localeCompare(b.expiry));

export function consumeLots(lots, n) {
  const out = [...lots].filter(l => Number(l.qty) > 0).sort((a, b) => a.expiry.localeCompare(b.expiry)).map(l => ({ ...l }));
  for (const l of out) { if (n <= 0) break; const k = Math.min(n, l.qty); l.qty -= k; n -= k; }
  return out.filter(l => l.qty > 0);
}

// Ajusta os lotes depois de mudar a quantidade: se os lotes somam mais que o estoque, tira dos que vencem primeiro.
// A validade do produto passa a ser a do lote que vence primeiro.
export function withQuantity(p, qty) {
  const next = { ...p, quantity: qty };
  if (!(p.lots || []).length) return next;
  const extra = lotsTotal(p) - qty;
  next.lots = extra > 0 ? consumeLots(p.lots, extra) : sortedLots(p);
  if (next.lots.length) next.expiry = next.lots[0].expiry;
  return next;
}

export function addLot(p, lot) {
  const lots = [...(p.lots || [])];
  const same = lots.find(l => l.expiry === lot.expiry);
  if (same) same.qty = Number(same.qty) + Number(lot.qty); else lots.push({ ...lot });
  const next = { ...p, lots: lots.filter(l => l.qty > 0).sort((a, b) => a.expiry.localeCompare(b.expiry)) };
  if (next.lots.length) next.expiry = next.lots[0].expiry;
  return next;
}

// vencimentos por mês: lotes (com a quantidade de cada um) e produtos com uma validade só
export function expiriesByMonth(products, now = new Date(), months = 6) {
  const start = localYmd(now).slice(0, 7);
  const end = (() => { const d = new Date(now.getFullYear(), now.getMonth() + months, 1); return localYmd(d).slice(0, 7); })();
  const out = new Map();
  const add = (month, item) => { if (!out.has(month)) out.set(month, []); out.get(month).push(item); };
  for (const p of products) {
    const lots = sortedLots(p);
    if (lots.length) lots.forEach(l => add(l.expiry.slice(0, 7), { id: p.id, name: p.name, qty: l.qty, expiry: l.expiry, price: p.price }));
    else if (/^\d{4}-\d{2}-\d{2}$/.test(p.expiry || '') && Number(p.quantity) > 0) add(p.expiry.slice(0, 7), { id: p.id, name: p.name, qty: Number(p.quantity), expiry: p.expiry, price: p.price });
  }
  return [...out.entries()].filter(([m]) => m < end).map(([m, items]) => ({ month: m, overdue: m < start, items: items.sort((a, b) => a.expiry.localeCompare(b.expiry)) }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

// ---------- custo ----------
const price = p => (p.price != null && p.price !== '' && Number(p.price) >= 0 ? Number(p.price) : null);
export function stockValue(products) {
  let value = 0, priced = 0;
  for (const p of products) { const v = price(p); if (v != null) { value += v * Number(p.quantity); priced++; } }
  return { value, priced, missing: products.length - priced };
}

// resumo de um mês ('AAAA-MM'): gasto com entradas, por fornecedor, perdas e consumo por produto
export function monthSummary(moves, month) {
  const ms = moves.filter(m => monthKey(m.at) === month);
  let spend = 0, losses = 0, lossUnits = 0;
  const bySupplier = new Map(), usage = new Map();
  for (const m of ms) {
    const v = m.price != null ? Number(m.price) : 0;
    if (m.type === 'entrada' && m.delta > 0) {
      spend += m.delta * v;
      const k = m.supplier || 'Sem fornecedor';
      const s = bySupplier.get(k) || { supplier: k, value: 0, units: 0 };
      s.value += m.delta * v; s.units += m.delta; bySupplier.set(k, s);
    }
    if (m.type === 'perda') { losses += -m.delta * v; lossUnits += -m.delta; }
    if (CONSUME_TYPES.includes(m.type)) {
      const u = usage.get(m.productId) || { id: m.productId, name: m.name, units: 0, value: 0 };
      u.units -= m.delta; u.value -= m.delta * v; usage.set(m.productId, u);
    }
  }
  return {
    spend, losses, lossUnits,
    bySupplier: [...bySupplier.values()].sort((a, b) => b.value - a.value || b.units - a.units),
    usage: [...usage.values()].filter(u => u.units > 0).sort((a, b) => b.units - a.units),
  };
}

export const brl = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ---------- pedido ----------
export function orderText(supplier, items, when = new Date()) {
  const d = localYmd(when).split('-').reverse().join('/');
  return `Olá! Pedido da Clínica KF (${d}) para ${supplier}:\n` +
    items.map(i => `• ${i.qty} × ${i.name}`).join('\n') + '\n\nObrigado!';
}
export const whatsappUrl = text => 'https://wa.me/?text=' + encodeURIComponent(text);

// ---------- histórico de preços ----------
// Cada preço registrado: mudança no cadastro ou na tela de preços (tipo "preco") e cada entrada de mercadoria com preço.
// Guarda só os pontos em que o preço ou o fornecedor mudou.
export function priceHistory(moves, productId) {
  const pts = moves.filter(m => m.productId === productId && m.price != null && (m.type === 'preco' || (m.type === 'entrada' && m.delta > 0)))
    .sort((a, b) => a.at.localeCompare(b.at));
  const out = [];
  for (const m of pts) {
    const last = out[out.length - 1];
    const pt = { at: m.at, price: Number(m.price), supplier: m.supplier || '', kind: m.type, by: m.by || '' };
    if (last && last.price === pt.price && last.supplier === pt.supplier) continue;
    out.push(pt);
  }
  return out;
}

// preço atual comparado com o anterior (o último preço diferente do atual)
export function priceTrend(history, current) {
  if (current == null) return null;
  const cur = Number(current);
  let curAt = null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].price === cur) { curAt = history[i].at; continue; }
    const prev = history[i];
    const pct = prev.price ? (cur - prev.price) / prev.price * 100 : null;
    return { prev: prev.price, prevAt: prev.at, prevSupplier: prev.supplier, since: curAt, diff: cur - prev.price, pct, dir: cur > prev.price ? 'up' : 'down' };
  }
  return { prev: null, since: curAt, dir: 'same' };
}

// último e menor preço por fornecedor (para comparar fornecedores)
export function priceBySupplier(history) {
  const m = new Map();
  for (const h of history) {
    const k = h.supplier || 'Sem fornecedor';
    const e = m.get(k) || { supplier: k, last: null, lastAt: null, min: Infinity, n: 0 };
    e.last = h.price; e.lastAt = h.at; e.min = Math.min(e.min, h.price); e.n++;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => a.last - b.last);
}

export const pctText = pct => (pct == null ? '' : `${pct > 0 ? '+' : ''}${(Math.round(pct * 10) / 10).toLocaleString('pt-BR')}%`);

// ---------- ordem da conferência ----------
// Primeiro o que mais muda (usado nos últimos 30 dias, mexido na última semana) e o que está perto do mínimo;
// depois o que quase não mexe. Assim, os erros mais prováveis são conferidos com mais atenção, no começo.
export function countPlan(products, moves, now = new Date(), isNear = () => false) {
  const t = now.getTime(), from30 = t - 30 * DAY, from7 = t - 7 * DAY;
  const byName = (a, b) => a.p.name.localeCompare(b.p.name, 'pt-BR');
  const info = products.map(p => {
    const mine = moves.filter(m => m.productId === p.id && m.type !== 'preco' && m.delta !== 0 && Date.parse(m.at) >= from30);
    const used = Math.max(0, -mine.filter(m => CONSUME_TYPES.includes(m.type)).reduce((n, m) => n + m.delta, 0));
    const moved7 = mine.some(m => Date.parse(m.at) >= from7);
    const near = !!isNear(p);
    return { p, used, moved7, near, moves: mine.length, score: (near ? 1e6 : 0) + used * 100 + mine.length * 10 + (moved7 ? 5 : 0) };
  });
  const hot = info.filter(x => x.near || x.used > 0 || x.moved7).sort((a, b) => b.score - a.score || byName(a, b));
  const calm = info.filter(x => !hot.includes(x)).sort(byName);
  return { first: hot, later: calm };
}
