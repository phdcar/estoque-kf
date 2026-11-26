import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consumption, forecastDays, suggestLevels, rateText, forecastText, consumeLots, withQuantity, addLot, lotsTotal,
  expiriesByMonth, stockValue, monthSummary, orderText, whatsappUrl, brl,
} from '../../js/insights.js';

const now = new Date('2026-11-26T12:00:00');
const mv = (daysAgo, type, delta, extra = {}) => ({ id: Math.random() + '', productId: 'a', name: 'Seringa', type, delta,
  at: new Date(now.getTime() - daysAgo * 864e5).toISOString(), ...extra });

test('consumo: saídas, conferência e ajustes contam; entrada e perda não', () => {
  const ms = [mv(20, 'entrada', 50), mv(14, 'saida', -10), mv(7, 'conferencia', -5), mv(3, 'ajuste', 1), mv(2, 'perda', -4)];
  const c = consumption(ms, 'a', now);
  assert.equal(c.used, 14);
  assert.equal(c.days, 20);
  assert.ok(Math.abs(c.perDay - 0.7) < 1e-9);
  assert.equal(c.enough, true);
  assert.equal(forecastDays({ quantity: 7 }, c), 10);
  assert.deepEqual(suggestLevels(c), { min: 5, ideal: 21 });
});

test('consumo: pouco histórico não prevê; janela de 30 dias', () => {
  const c = consumption([mv(3, 'saida', -6)], 'a', now);
  assert.equal(c.enough, false);
  assert.equal(forecastDays({ quantity: 5 }, c), null);
  assert.equal(suggestLevels(c), null);
  const old = consumption([mv(90, 'entrada', 10), mv(60, 'saida', -30), mv(10, 'saida', -3)], 'a', now);
  assert.equal(old.used, 3); assert.equal(old.days, 30);
  assert.equal(consumption([], 'a', now).perDay, 0);
});

test('textos de consumo e previsão', () => {
  assert.equal(rateText(0), 'Sem consumo registrado');
  assert.equal(rateText(2), '~2 por dia');
  assert.equal(rateText(0.5), '~3,5 por semana');
  assert.equal(rateText(0.05), '~1,5 por mês');
  assert.equal(forecastText(0), 'Acaba hoje');
  assert.equal(forecastText(1), 'Acaba em ~1 dia');
  assert.equal(forecastText(12), 'Acaba em ~12 dias');
  assert.equal(forecastText(200), 'Dura mais de 6 meses');
});

test('lotes: sai primeiro o que vence primeiro', () => {
  const lots = [{ id: 'b', expiry: '2027-05-01', qty: 10 }, { id: 'a', expiry: '2027-01-01', qty: 4 }];
  assert.deepEqual(consumeLots(lots, 6), [{ id: 'b', expiry: '2027-05-01', qty: 8 }]);
  const p = { id: 'x', quantity: 14, lots, expiry: '2027-01-01' };
  const q = withQuantity(p, 12);
  assert.deepEqual(q.lots.map(l => [l.id, l.qty]), [['a', 2], ['b', 10]]);
  assert.equal(q.expiry, '2027-01-01');
  const r = withQuantity(p, 9);
  assert.deepEqual(r.lots.map(l => [l.id, l.qty]), [['b', 9]]);
  assert.equal(r.expiry, '2027-05-01');
  // aumentar a quantidade sem lote não mexe nos lotes
  assert.equal(lotsTotal(withQuantity(p, 20)), 14);
  // lote novo com a mesma validade soma
  const s = addLot(p, { id: 'c', expiry: '2027-01-01', qty: 3 });
  assert.deepEqual(s.lots.map(l => [l.expiry, l.qty]), [['2027-01-01', 7], ['2027-05-01', 10]]);
  assert.equal(addLot({ id: 'y', quantity: 0, expiry: '' }, { id: 'd', expiry: '2026-12-20', qty: 5 }).expiry, '2026-12-20');
});

test('vencimentos por mês (lotes e validade única)', () => {
  const ps = [
    { id: '1', name: 'Seringa', quantity: 14, lots: [{ id: 'a', expiry: '2026-12-20', qty: 4 }, { id: 'b', expiry: '2027-02-10', qty: 10 }] },
    { id: '2', name: 'Álcool', quantity: 3, expiry: '2026-12-05' },
    { id: '3', name: 'Agulha', quantity: 50, expiry: 'ND' },
    { id: '4', name: 'Soro', quantity: 2, expiry: '2026-10-01' },
    { id: '5', name: 'Gaze', quantity: 9, expiry: '2028-01-01' },
  ];
  const m = expiriesByMonth(ps, now, 6);
  assert.deepEqual(m.map(x => [x.month, x.overdue, x.items.map(i => `${i.name}:${i.qty}`).join(',')]), [
    ['2026-10', true, 'Soro:2'], ['2026-12', false, 'Álcool:3,Seringa:4'], ['2027-02', false, 'Seringa:10'],
  ]);
});

test('custo: valor em estoque, gasto do mês, por fornecedor, perdas e consumo', () => {
  assert.deepEqual(stockValue([{ quantity: 10, price: 2.5 }, { quantity: 3, price: null }, { quantity: 4, price: 0 }]), { value: 25, priced: 2, missing: 1 });
  const ms = [
    { productId: 'a', name: 'Seringa', type: 'entrada', delta: 10, price: 2, supplier: 'Cremer', at: '2026-11-10T12:00:00' },
    { productId: 'b', name: 'Fio', type: 'entrada', delta: 2, price: 30, supplier: 'Mercado Livre', at: '2026-11-11T12:00:00' },
    { productId: 'a', name: 'Seringa', type: 'saida', delta: -3, price: 2, at: '2026-11-12T12:00:00' },
    { productId: 'a', name: 'Seringa', type: 'conferencia', delta: -1, price: 2, at: '2026-11-13T12:00:00' },
    { productId: 'b', name: 'Fio', type: 'perda', delta: -1, price: 30, at: '2026-11-14T12:00:00' },
    { productId: 'a', name: 'Seringa', type: 'entrada', delta: 5, price: 2, supplier: 'Cremer', at: '2026-10-30T12:00:00' },
  ];
  const s = monthSummary(ms, '2026-11');
  assert.equal(s.spend, 80);
  assert.equal(s.losses, 30); assert.equal(s.lossUnits, 1);
  assert.deepEqual(s.bySupplier.map(x => [x.supplier, x.value]), [['Mercado Livre', 60], ['Cremer', 20]]);
  assert.deepEqual(s.usage.map(u => [u.name, u.units, u.value]), [['Seringa', 4, 8]]);
  assert.equal(brl(1234.5).replace(/\s/g, ' '), 'R$ 1.234,50');
});

test('texto do pedido e link do WhatsApp', () => {
  const t = orderText('Dental Cremer', [{ qty: 10, name: 'Seringa 5 ml' }, { qty: 2, name: 'Álcool 70%' }], now);
  assert.equal(t, 'Olá! Pedido da Clínica KF (26/11/2026) para Dental Cremer:\n• 10 × Seringa 5 ml\n• 2 × Álcool 70%\n\nObrigado!');
  assert.match(whatsappUrl(t), /^https:\/\/wa\.me\/\?text=Ol%C3%A1!/);
});

test('histórico de preços: mudanças, tendência e fornecedores', async () => {
  const { priceHistory, priceTrend, priceBySupplier, pctText } = await import('../../js/insights.js');
  const mv = (type, price, supplier, at, delta = 0) => ({ productId: 'a', type, price, supplier, at, delta });
  const moves = [
    mv('saida', 10, 'X', '2026-10-01T10:00:00Z', -1),       // saída não conta como preço
    mv('preco', 10, 'X', '2026-10-02T10:00:00Z'),
    mv('entrada', 10, 'X', '2026-10-05T10:00:00Z', 5),      // mesmo preço e fornecedor: ignora
    mv('entrada', 9, 'Y', '2026-10-20T10:00:00Z', 5),
    mv('preco', 12, 'X', '2026-11-10T10:00:00Z'),
    mv('preco', 5, 'X', '2026-11-11T10:00:00Z', 0), // outro produto abaixo
  ];
  moves[5].productId = 'b';
  const h = priceHistory(moves, 'a');
  assert.deepEqual(h.map(x => [x.price, x.supplier]), [[10, 'X'], [9, 'Y'], [12, 'X']]);
  const t = priceTrend(h, 12);
  assert.equal(t.prev, 9); assert.equal(t.dir, 'up'); assert.equal(Math.round(t.pct), 33);
  assert.equal(priceTrend(h, 9).dir, 'down');
  assert.equal(priceTrend([], 7).dir, 'same');
  assert.equal(priceTrend(h, null), null);
  assert.deepEqual(priceBySupplier(h).map(s => [s.supplier, s.last, s.min]), [['Y', 9, 9], ['X', 12, 10]]);
  assert.equal(pctText(33.333), '+33,3%');
  assert.equal(pctText(-5), '-5%');
});
