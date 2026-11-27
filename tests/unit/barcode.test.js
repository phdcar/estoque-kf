import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupBarcode, isRetailCode, suggestionFrom } from '../../js/barcode-lookup.js';

const res = (status, body) => ({ ok: status === 200, status, json: async () => body });

test('código de varejo: EAN-8, UPC-A, EAN-13 e GTIN-14', () => {
  assert.equal(isRetailCode('7894900011517'), true);
  assert.equal(isRetailCode('12345678'), true);
  assert.equal(isRetailCode('012345678905'), true);
  assert.equal(isRetailCode('ABC-123'), false);
  assert.equal(isRetailCode('12345'), false);
});

test('sugestão junta nome e quantidade sem repetir', () => {
  assert.deepEqual(suggestionFrom({ product_name: 'Refrigerante Coca-Cola 2Lt', quantity: '2l', brands: 'Coca-Cola,The Coca-Cola Company' }),
    { name: 'Refrigerante Coca-Cola 2Lt', brand: 'Coca-Cola', image: '' });
  assert.equal(suggestionFrom({ product_name_pt: 'Álcool em gel', product_name: 'Alcohol gel', quantity: '500 ml' }).name, 'Álcool em gel 500 ml');
  assert.equal(suggestionFrom({ product_name: '' }), null);
});

test('procura nas três bases e usa a que conhece o código', async () => {
  const urls = [];
  const fetchFn = async url => {
    urls.push(url);
    if (url.includes('openbeautyfacts')) return res(200, { status: 1, product: { product_name: 'Sabonete líquido', quantity: '250 ml', brands: 'Marca X' } });
    return res(404, { status: 0 });
  };
  const s = await lookupBarcode('7891000000001', { fetchFn });
  assert.equal(urls.length, 3);
  assert.ok(urls.every(u => u.includes('/api/v2/product/7891000000001.json')));
  assert.deepEqual(s, { name: 'Sabonete líquido 250 ml', brand: 'Marca X', image: '', source: 'Open Beauty Facts' });
});

test('não achou, sem internet ou código fora do padrão: null', async () => {
  assert.equal(await lookupBarcode('7891000000001', { fetchFn: async () => res(404, { status: 0 }) }), null);
  assert.equal(await lookupBarcode('7891000000001', { fetchFn: async () => { throw new TypeError('Failed to fetch'); } }), null);
  let called = false;
  assert.equal(await lookupBarcode('LOTE-42', { fetchFn: async () => { called = true; } }), null);
  assert.equal(called, false);
});
