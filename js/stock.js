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
  return out;
}

// quanto falta para chegar ao mínimo
export const need = p => Math.max(0, Number(p.min) - Number(p.quantity));

// lista de compras agrupada por fornecedor (só produtos abaixo do mínimo)
export function shoppingList(products) {
  const groups = new Map();
  for (const p of products) {
    if (!isLow(p)) continue;
    const s = String(p.supplier || '').trim() || 'Sem fornecedor';
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push({ id: p.id, name: p.name, quantity: Number(p.quantity), min: Number(p.min), need: need(p) });
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
    for (const i of g.items) lines.push(`• ${i.name}: comprar ${i.need} (tem ${i.quantity}, mínimo ${i.min})`);
  }
  return lines.join('\n');
}

export function summary(products) {
  const s = { total: products.length, esgotado: 0, critico: 0, atencao: 0, ok: 0, semMinimo: 0, incompleto: 0 };
  for (const p of products) {
    const l = level(p);
    if (l === 'esgotado') s.esgotado++;
    else if (l === 'critico') s.critico++;
    else if (l === 'atencao') s.atencao++;
    else if (l === 'ok') s.ok++;
    else s.semMinimo++;
    if (missing(p).length) s.incompleto++;
  }
  s.alerta = s.esgotado + s.critico;
  return s;
}
