// Versão 0.8.2: procura um código de barras (EAN/UPC) em bases públicas e gratuitas para sugerir o nome do produto.
// Bases: Open Food Facts, Open Beauty Facts e Open Products Facts (mesmo formato, aceitam chamadas do navegador).
// Só o número do código é enviado; nenhum dado da clínica sai do app.
// Funciona bem com produtos de mercado; material odontológico raramente está nessas bases.

export const SOURCES = [
  { name: 'Open Food Facts', base: 'https://world.openfoodfacts.org' },
  { name: 'Open Beauty Facts', base: 'https://world.openbeautyfacts.org' },
  { name: 'Open Products Facts', base: 'https://world.openproductsfacts.org' },
];

// EAN-8, UPC-A (12), EAN-13 e GTIN-14
export const isRetailCode = code => /^\d{8}$|^\d{12,14}$/.test(String(code || ''));

const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

// junta nome e quantidade ("Refrigerante cola" + "2 l"), sem repetir a quantidade se já estiver no nome
export function suggestionFrom(product) {
  const name = clean(product.product_name_pt || product.product_name || product.generic_name_pt || product.generic_name);
  if (!name) return null;
  const qty = clean(product.quantity);
  const brand = clean(String(product.brands || '').split(',')[0]);
  const hasQty = qty && name.toLowerCase().replace(/\s/g, '').includes(qty.toLowerCase().replace(/\s/g, ''));
  return { name: hasQty || !qty ? name : `${name} ${qty}`, brand, image: product.image_small_url || product.image_front_small_url || '' };
}

async function one(src, code, fetchFn, timeout) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl && setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetchFn(`${src.base}/api/v2/product/${code}.json?fields=product_name,product_name_pt,generic_name,generic_name_pt,brands,quantity,image_small_url,image_front_small_url&lc=pt`,
      ctl ? { signal: ctl.signal } : {});
    if (!r.ok) return null;
    const j = await r.json();
    if (j.status !== 1 || !j.product) return null;
    const s = suggestionFrom(j.product);
    return s ? { ...s, source: src.name } : null;
  } catch { return null; } finally { if (timer) clearTimeout(timer); }
}

// devolve { name, brand, image, source } da primeira base que conhece o código, ou null
// (código fora do padrão de varejo, sem internet ou não encontrado)
export async function lookupBarcode(code, { fetchFn = (...a) => fetch(...a), timeout = 7000 } = {}) {
  if (!isRetailCode(code)) return null;
  const results = await Promise.all(SOURCES.map(s => one(s, code, fetchFn, timeout)));
  return results.find(Boolean) || null;
}
