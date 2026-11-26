import { test } from 'node:test';
import assert from 'node:assert/strict';
import { level, isLow, missing, need, shoppingList, shoppingText, summary, expiryLevel, expiryText, daysToExpiry } from '../../js/stock.js';

const P = (name, quantity, min, supplier = 'Cremer', category = 'Insumos', expiry = 'ND') => ({ id: name, name, quantity, min, supplier, category, expiry });

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
  assert.deepEqual(missing(P('a', 1, 0, '', ' ', '')), ['fornecedor', 'categoria', 'estoque mínimo', 'validade']);
  assert.deepEqual(missing(P('a', 1, 2, 'X', 'Y', '2027-01-01')), []);
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

test('validade', () => {
  const hoje = new Date(2026, 10, 26, 15, 0);
  const E = expiry => P('x', 5, 1, 'C', 'I', expiry);
  assert.equal(expiryLevel(E('ND'), hoje), 'nd');
  assert.equal(expiryText(E('ND'), hoje), 'ND · sem validade');
  assert.equal(expiryLevel(E(''), hoje), 'sem-validade');
  assert.equal(expiryLevel(E('2026-11-25'), hoje), 'vencido');
  assert.equal(expiryText(E('2026-11-25'), hoje), 'Venceu ontem');
  assert.equal(expiryText(E('2026-11-20'), hoje), 'Vencido há 6 dias');
  assert.equal(expiryLevel(E('2026-11-26'), hoje), 'vence-logo');
  assert.equal(expiryText(E('2026-11-26'), hoje), 'Vence hoje');
  assert.equal(daysToExpiry(E('2026-12-26'), hoje), 30);
  assert.equal(expiryLevel(E('2026-12-26'), hoje), 'vence-logo');
  assert.equal(expiryLevel(E('2026-12-27'), hoje), 'ok');
  assert.equal(expiryText(E('2027-03-05'), hoje), 'Validade 05/03/2027');
  const s = summary([E('2026-11-01'), E('2026-12-01'), E('ND'), E('')], hoje);
  assert.deepEqual([s.vencido, s.venceLogo, s.semValidade], [1, 1, 1]);
});

test('comprar até o ideal', async () => {
  const { buy } = await import('../../js/stock.js');
  assert.equal(buy({ quantity: 6, min: 10, ideal: 50 }), 44);
  assert.equal(buy({ quantity: 6, min: 10 }), 4);
  assert.equal(buy({ quantity: 20, min: 20, ideal: 10 }), 0);
  const l = shoppingList([{ id: 'a', name: 'Soro', quantity: 6, min: 10, ideal: 50, supplier: 'ML' }]);
  assert.equal(l[0].items[0].need, 44);
  assert.match(shoppingText(l), /comprar 44 \(tem 6, mínimo 10, ideal 50\)/);
});

test('nome só com a primeira letra maiúscula', async () => {
  const { sentenceCase } = await import('../../js/stock.js');
  assert.equal(sentenceCase('AGULHA 32G 6MM'), 'Agulha 32G 6mm');
  assert.equal(sentenceCase('LUVA XP'), 'Luva XP');
  assert.equal(sentenceCase('Luva de procedimento M'), 'Luva de procedimento M');
  assert.equal(sentenceCase('GAZE Estéril'), 'Gaze estéril');
  assert.equal(sentenceCase('álcool 70%'), 'Álcool 70%');
});

