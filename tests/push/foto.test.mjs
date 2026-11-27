// Testa a contagem por foto (versão 0.9): texto enviado ao Claude e limpeza da resposta.
// Uso: node --experimental-strip-types tests/push/foto.test.mjs
import assert from 'node:assert/strict';
const { prompt, limpar, SCHEMA } = await import('../../supabase/functions/kf-foto/index.ts');

const t = prompt([{ id: 'a1', nome: 'Seringa 1ml Luer Lock', fornecedor: 'Dental Cremer' }, { id: 'b2', nome: 'Agulha 32G 6mm' }]);
assert.match(t, /id a1: Seringa 1ml Luer Lock \(fornecedor Dental Cremer\)/);
assert.match(t, /id b2: Agulha 32G 6mm\n/);
assert.deepEqual(SCHEMA.required, ['itens', 'outros']);

const ids = new Set(['a1', 'b2']);
const r = limpar({
  itens: [
    { produto_id: 'a1', quantidade: 4.6, validade: '2027-03-31', lote: ' L2345 ', certeza: 'alta', obs: '' },
    { produto_id: 'a1', quantidade: 9, validade: null, lote: null, certeza: 'alta', obs: '' },        // repetido: ignora
    { produto_id: 'zz', quantidade: 3, validade: null, lote: null, certeza: 'alta', obs: '' },        // id inventado: ignora
    { produto_id: 'b2', quantidade: -2, validade: '03/2027', lote: '', certeza: 'talvez', obs: 'Atrás' },
  ],
  outros: ['Luvas', '', 7],
}, ids);
assert.deepEqual(r.itens, [
  { produto_id: 'a1', quantidade: 5, validade: '2027-03-31', lote: 'L2345', certeza: 'alta', obs: '' },
  { produto_id: 'b2', quantidade: 0, validade: null, lote: null, certeza: 'baixa', obs: 'Atrás' },
]);
assert.deepEqual(r.outros, ['Luvas']);
assert.deepEqual(limpar(null, ids), { itens: [], outros: [] });
assert.equal(limpar({ itens: [{ produto_id: 'a1', quantidade: 1, validade: '2027-02', certeza: 'media' }] }, ids).itens[0].validade, '2027-02');
console.log('foto OK');
