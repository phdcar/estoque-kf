import { test } from 'node:test';
import assert from 'node:assert/strict';
import { level, isLow, missing, need, shoppingList, shoppingText, summary } from '../../js/stock.js';

const P = (name, quantity, min, supplier = 'Cremer', category = 'Insumos') => ({ id: name, name, quantity, min, supplier, category });

test('nível no radar', () => {
  assert.equal(level(P('a', 0, 5)), 'esgotado');
  assert.equal(level(P('a', 4, 5)), 'critico');
  assert.equal(level(P('a', 5, 5)), 'atencao');      // no mínimo
  assert.equal(level(P('a', 7, 5)), 'atencao');      // até 25% acima (2 unidades)
  assert.equal(level(P('a', 8, 5)), 'ok');
  assert.equal(level(P('a', 2, 1)), 'atencao');      // margem mínima de 1 unidade
  assert.equal(level(P('a', 3, 1)), 'ok');
  assert.equal(level(P('a', 3, 0)), 'sem-minimo');
  assert.equal(level(P('a', 0, 0)), 'esgotado-sem-minimo');
});

test('abaixo do mínimo é estrito (quantidade < mínimo)', () => {
  assert.equal(isLow(P('a', 4, 5)), true);
  assert.equal(isLow(P('a', 5, 5)), false);
  assert.equal(need(P('a', 1, 5)), 4);
  assert.equal(need(P('a', 9, 5)), 0);
});

test('campos obrigatórios', () => {
  assert.deepEqual(missing(P('a', 1, 2)), []);
  assert.deepEqual(missing(P('a', 1, 0, '', ' ')), ['fornecedor', 'categoria', 'estoque mínimo']);
});

test('lista de compras por fornecedor', () => {
  const list = shoppingList([P('Luva', 1, 10, 'Cremer'), P('Gaze', 0, 3, 'Mercado Livre'), P('Agulha', 2, 5, ''),
    P('Álcool', 9, 5, 'Cremer'), P('Seringa', 0, 2, 'Cremer')]);
  assert.deepEqual(list.map(g => g.supplier), ['Cremer', 'Mercado Livre', 'Sem fornecedor']);
  assert.deepEqual(list[0].items.map(i => [i.name, i.need]), [['Luva', 9], ['Seringa', 2]]);
  const txt = shoppingText(list, new Date(2026, 10, 26));
  assert.match(txt, /26\/11\/2026/);
  assert.match(txt, /• Luva: comprar 9 \(tem 1, mínimo 10\)/);
});

test('resumo', () => {
  const s = summary([P('a', 0, 5), P('b', 1, 5), P('c', 5, 5), P('d', 50, 5), P('e', 3, 0, '')]);
  assert.deepEqual([s.esgotado, s.critico, s.atencao, s.ok, s.semMinimo, s.incompleto, s.alerta], [1, 1, 1, 1, 1, 1, 2]);
});
