// Regras do radar de estoque (sem dependência de tela, testadas em tests/unit).

// margem de "atenção": no mínimo ou até 25% acima dele (pelo menos 1 unidade)
export const attentionMargin = min => Math.max(1, Math.ceil(min * 0.25));

// nível do produto no radar
//  sem-minimo: mínimo não definido (o radar não consegue vigiar)
//  esgotado:   quantidade 0
//  critico:    abaixo do mínimo
//  atencao:    no mínimo ou logo acima
//  ok:         folga
export function level(p) {
  const q = Number(p.quantity), m = Number(p.min);
  if (!(m >= 1)) return q === 0 ? 'esgotado-sem-minimo' : 'sem-minimo';
  if (q <= 0) return 'esgotado';
  if (q < m) return 'critico';
  if (q <= m + attentionMargin(m)) return 'atencao';
  return 'ok';
}

// abaixo do mínimo (regra combinada: quantidade < mínimo)
export const isLow = p => Number(p.quantity) < Number(p.min);
export const isAlert = p => ['esgotado', 'critico'].includes(level(p));

// campos obrigatórios que faltam
export function missing(p) {
  const out = [];
  if (!String(p.supplier || '').trim()) out.push('fornecedor');
  if (!String(p.category || '').trim()) out.push('categoria');
  if (!(Number(p.min) >= 1)) out.push('estoque mínimo');
  if (!hasExpiryInfo(p)) out.push('validade');
  return out;
}

// quanto falta para chegar ao mínimo
export const need = p => Math.max(0, Number(p.min) - Number(p.quantity));
// quanto comprar: até o estoque ideal, quando ele existe; senão, até o mínimo
export const buy = p => Math.max(need(p), Number(p.ideal) >= 1 ? Number(p.ideal) - Number(p.quantity) : 0);

// lista de compras agrupada por fornecedor (só produtos abaixo do mínimo)
export function shoppingList(products) {
  const groups = new Map();
  for (const p of products) {
    if (!isLow(p)) continue;
    const s = String(p.supplier || '').trim() || 'Sem fornecedor';
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push({ id: p.id, name: p.name, quantity: Number(p.quantity), min: Number(p.min), ideal: Number(p.ideal) || null, need: buy(p) });
  }
  const cmp = (a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' });
  return [...groups.entries()]
    .sort(([a], [b]) => (a === 'Sem fornecedor') - (b === 'Sem fornecedor') || cmp(a, b))
    .map(([supplier, items]) => ({ supplier, items: items.sort((a, b) => cmp(a.name, b.name)) }));
}

// texto para enviar por WhatsApp/e-mail
export function shoppingText(list, when = new Date()) {
  const d = when.toLocaleDateString('pt-BR');
  const lines = [`Clínica KF · Reposição de estoque · ${d}`];
  for (const g of list) {
    lines.push('', g.supplier.toUpperCase());
    for (const i of g.items) lines.push(`• ${i.name}: comprar ${i.need} (tem ${i.quantity}, mínimo ${i.min}${i.ideal ? `, ideal ${i.ideal}` : ''})`);
  }
  return lines.join('\n');
}

export function summary(products, now = new Date()) {
  const s = { total: products.length, esgotado: 0, critico: 0, atencao: 0, ok: 0, semMinimo: 0, incompleto: 0, vencido: 0, venceLogo: 0, semValidade: 0 };
  for (const p of products) {
    const l = level(p);
    if (l === 'esgotado') s.esgotado++;
    else if (l === 'critico') s.critico++;
    else if (l === 'atencao') s.atencao++;
    else if (l === 'ok') s.ok++;
    else s.semMinimo++;
    if (missing(p).length) s.incompleto++;
    const e = expiryLevel(p, now);
    if (e === 'vencido') s.vencido++; else if (e === 'vence-logo') s.venceLogo++; else if (e === 'sem-validade') s.semValidade++;
  }
  s.alerta = s.esgotado + s.critico;
  return s;
}

// ---------- validade ----------
// p.expiry: 'AAAA-MM-DD', 'ND' (produto sem validade, ex.: agulha) ou vazio (não informado). "vence logo" = até EXPIRY_SOON dias.
export const EXPIRY_SOON = 30;
export const NO_EXPIRY = 'ND';
export const hasExpiryInfo = p => p.expiry === NO_EXPIRY || /^\d{4}-\d{2}-\d{2}$/.test(String(p.expiry || ''));
const dayNum = s => { const [y, m, d] = String(s).split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
const todayStr = now => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
export function daysToExpiry(p, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.expiry || ''))) return null;
  return dayNum(p.expiry) - dayNum(todayStr(now));
}
// 'vencido' | 'vence-logo' | 'ok' | 'sem-validade'
export function expiryLevel(p, now = new Date()) {
  const d = daysToExpiry(p, now);
  if (p.expiry === NO_EXPIRY) return 'nd';
  if (d === null) return 'sem-validade';
  if (d < 0) return 'vencido';
  if (d <= EXPIRY_SOON) return 'vence-logo';
  return 'ok';
}
export function expiryText(p, now = new Date()) {
  if (p.expiry === NO_EXPIRY) return 'ND · sem validade';
  const d = daysToExpiry(p, now);
  if (d === null) return '';
  if (d < -1) return `Vencido há ${-d} dias`;
  if (d === -1) return 'Venceu ontem';
  if (d === 0) return 'Vence hoje';
  if (d === 1) return 'Vence amanhã';
  if (d <= EXPIRY_SOON) return `Vence em ${d} dias`;
  const [y, m, dd] = p.expiry.split('-');
  return `Validade ${dd}/${m}/${y}`;
}

// Nomes sempre com só a primeira letra maiúscula (regra do dono).
// Preserva códigos como 32G, 30 UI, XP; unidades ficam em minúsculas (ml, mm, cm, g).
const KEEP = /^(\d+G|\d+L|UI|XP|KF|ND|L)$/;
export function sentenceCase(s) {
  const t = String(s || '').trim();
  if (!t) return t;
  const parts = t.split(' ');
  const words = parts.map((w, i) => {
    if (i === parts.length - 1 && i > 0 && /^(PP|P|M|G|GG|XG)$/i.test(w)) return w.toUpperCase(); // tamanho
    if (KEEP.test(w.toUpperCase()) && /\d|UI|XP|KF|ND|^L$/i.test(w)) return w.toUpperCase().replace(/^(\d+)G$/, '$1G');
    return w.toLowerCase();
  });
  const out = words.join(' ');
  return out.charAt(0).toUpperCase() + out.slice(1);
}
