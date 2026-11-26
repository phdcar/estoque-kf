// Testa o relatório mensal: cálculos e PDF (precisa do pdf-lib instalado; PDFLIB_DIR=<pasta node_modules>).
// Uso: PDFLIB_DIR=/caminho/node_modules node --experimental-strip-types tests/push/relatorio.test.mjs [saida.pdf]
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(path.join(process.env.PDFLIB_DIR || '.', 'x.js'));
const PDFLib = require('pdf-lib');
const { resumo, montarPdf } = await import('../../supabase/functions/kf-relatorio/index.ts');

const produtos = [
  { id: 'a', nome: 'Seringa 5 ml', quantidade: 3, minimo: 10, preco: 0.8, lotes: [{ id: 'l', validade: '2026-12-20', qtd: 3 }], excluido: false },
  { id: 'b', nome: 'Fio de sutura', quantidade: 6, minimo: 2, preco: 30, lotes: [], validade: '2027-06-01', excluido: false },
  { id: 'c', nome: 'Agulha 32G 6mm', quantidade: 100, minimo: 20, preco: null, lotes: [], sem_validade: true, excluido: false },
  { id: 'd', nome: 'Apagado', quantidade: 1, minimo: 1, preco: 1, lotes: [], excluido: true },
];
const mv = (produto_id, produto, tipo, delta, preco, feito_em, fornecedor) => ({ produto_id, produto, tipo, delta, preco, feito_em, fornecedor });
const movimentos = [
  mv('a', 'Seringa 5 ml', 'entrada', 50, 0.8, '2026-11-03T13:00:00Z', 'Dental Cremer'),
  mv('a', 'Seringa 5 ml', 'saida', -40, 0.8, '2026-11-10T13:00:00Z'),
  mv('a', 'Seringa 5 ml', 'conferencia', -7, 0.8, '2026-11-20T13:00:00Z'),
  mv('b', 'Fio de sutura', 'entrada', 4, 30, '2026-11-05T13:00:00Z', 'Mercado Livre'),
  mv('b', 'Fio de sutura', 'perda', -1, 30, '2026-11-25T13:00:00Z'),
  mv('b', 'Fio de sutura', 'entrada', 9, 30, '2026-12-01T02:00:00Z', 'Mercado Livre'), // 30/11 23h em Brasília: ainda é novembro
];
const conferencias = [
  { dia: '2026-11-23', por_nome: 'Bruna' }, { dia: '2026-11-24', por_nome: 'Bruna' },
  { dia: '2026-11-26', por_nome: 'Bruna', justificativa: 'Faltei por motivo de saúde.', dias: ['2026-11-25'] },
];
const pedidos = [{ fornecedor: 'Dental Cremer', criado_em: '2026-11-02T12:00:00Z', status: 'recebido' }, { fornecedor: 'X', criado_em: '2026-11-02T12:00:00Z', status: 'cancelado' }];
const r = resumo({ mes: '2026-11', hoje: '2026-11-27', produtos, movimentos, conferencias, pedidos, config: { inicio: '2026-11-23' } });
assert.equal(r.gasto, 50 * 0.8 + 4 * 30 + 9 * 30);
assert.equal(r.perdas, 30);
assert.equal(r.valor, 3 * 0.8 + 6 * 30);
assert.equal(r.semPreco, 1);
assert.deepEqual(r.fornecedores.map(f => f.nome), ['Mercado Livre', 'Dental Cremer']);
assert.deepEqual(r.uso.map(u => [u.nome, u.un]), [['Seringa 5 ml', 47]]);
assert.deepEqual([r.diasUteis, r.feitas, r.justificadas, r.naoFeitas], [4, 2, 1, 1]); // 23, 24, 25 (justificada), 26 (não feita)
assert.deepEqual(r.abaixo.map(p => p.nome), ['Seringa 5 ml']);
assert.deepEqual(r.vencimentos.map(v => v.nome), ['Seringa 5 ml']);
assert.equal(r.pedidos.length, 1);
const pdf = await montarPdf(PDFLib, r);
const back = await PDFLib.PDFDocument.load(pdf);
assert.ok(back.getPageCount() >= 1);
if (process.argv[2]) writeFileSync(process.argv[2], pdf);
console.log(`relatório: cálculos OK, PDF com ${back.getPageCount()} página(s), ${pdf.length} bytes`);
