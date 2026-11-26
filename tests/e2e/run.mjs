// Teste ponta a ponta no Chromium (emulando dois celulares Android: dono e funcionário)
// com relógio controlado e um Supabase FALSO (tests/e2e/fake-supabase.mjs).
// Uso: node tests/e2e/run.mjs   (gera capturas em tests/e2e/shots/)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { FakeSupabase, FAKE_URL } from './fake-supabase.mjs';
// usa o Playwright instalado globalmente ou o do projeto
const { chromium, devices } = createRequire(import.meta.url)('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIX = path.join(ROOT, 'tests/fixtures');
const SHOTS = path.join(ROOT, 'tests/e2e/shots');
mkdirSync(SHOTS, { recursive: true });
const PORT = 8123;
const URL = `http://localhost:${PORT}/`;

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

let passed = 0;
const step = async (name, fn) => {
  try { await fn(); passed++; console.log('  ok  ', name); }
  catch (e) { console.log('  FALHOU', name, '\n', e); throw e; }
};

const browser = await chromium.launch();
const errors = [];
const fake = new FakeSupabase();
async function device(label) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  await fake.attach(ctx);
  await ctx.addInitScript(url => { window.__KF_CONFIG = { url, key: 'chave-anon-de-teste', realtime: false, pollSeconds: 3 }; }, FAKE_URL);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`[${label}] ${e.message}`));
  page.on('console', m => {
    // falhas de rede esperadas quando o teste desliga a internet
    if (m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|Failed to load resource|ERR_CONNECTION_REFUSED/.test(m.text())) errors.push(`[${label}] console: ${m.text()}`);
  });
  page.on('dialog', d => d.accept(page.__dialogAnswer ?? undefined));
  return { ctx, page };
}
// navega e espera a tela terminar de desenhar (a renderização é assíncrona)
async function nav(page, hash) {
  await page.goto(URL + hash);
  await page.waitForFunction(() => !!window.__app);
  await page.evaluate(() => window.__app.idle());
}
// espera a tela mudar para a rota indicada e terminar de desenhar
async function waitHash(page, prefix) {
  await page.waitForFunction(p => location.hash.startsWith(p), prefix);
  await page.evaluate(() => window.__app.idle());
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });
// espera a sincronização terminar
const synced = page => page.evaluate(async () => { await window.__app.cloud.requestSync(); await window.__app.idle(); return window.__app.cloud.state; });
async function signup(page, { name, email, code }) {
  await page.goto(URL);
  await page.waitForFunction(() => !!window.__app);
  await page.click('.toggle button[data-m=criar]');
  await page.fill('#nm', name);
  await page.fill('#em', email);
  await page.fill('#pw', 'senha-teste-123');
  if (code !== undefined) await page.fill('#cd', code);
  await page.click('#go');
}
const setTime = async (page, iso) => { await page.clock.setSystemTime(new Date(iso)); await page.reload(); await page.waitForFunction(() => !!window.__app); await page.evaluate(() => window.__app.idle()); };

async function addProduct(page, { name, qty, min, file, supplier, expiry = 'ND' }) {
  await nav(page, '#novo');
  await page.fill('#nm', name);
  await page.fill('#ct', 'Insumos');
  await page.fill('#fn', supplier || 'Cremer');
  await page.fill('#qt', String(qty));
  await page.fill('#mn', String(min));
  if (expiry === 'ND') await page.check('#nd'); else await page.fill('#vl', expiry);
  const t0 = Date.now();
  await page.setInputFiles('#f-gal', path.join(FIX, file));
  await page.waitForSelector('#pv:not(.hidden)');
  await page.waitForFunction(() => document.querySelector('#pv-line').naturalWidth > 0 && document.querySelector('#pv-orig').naturalWidth > 0);
  const ms = Date.now() - t0;
  const dims = await page.evaluate(() => ({
    lw: document.querySelector('#pv-line').naturalWidth, lh: document.querySelector('#pv-line').naturalHeight,
    ow: document.querySelector('#pv-orig').naturalWidth, oh: document.querySelector('#pv-orig').naturalHeight,
  }));
  await page.click('#save');
  await page.waitForFunction(() => location.hash.startsWith('#produto/'));
  await page.evaluate(() => window.__app.idle());
  try { await page.waitForURL(/#produto\//, { timeout: 10000 }); }
  catch (e) { await shot(page, 'erro-' + name.replace(/\W+/g, '-')); console.log('URL', page.url(), 'err:', await page.textContent('#err').catch(() => '?')); throw e; }
  return { ms, dims };
}

try {
  // ================= Dono cria a conta e a clínica =================
  const own = await device('dono');
  const op = own.page;
  await op.clock.install({ time: new Date('2026-11-26T08:30:00-03:00') }); // quinta, dia de conferência
  let code;
  await step('dono cria a primeira conta e vira dono', async () => {
    await op.goto(URL);
    await op.waitForSelector('.auth #em');
    await shot(op, '01-entrar');
    await signup(op, { name: 'Carlos', email: 'dono@teste.kf' });
    await waitHash(op, '#painel');
    await op.getByText('Nenhum produto abaixo do mínimo.').waitFor();
    assert.match(await op.textContent('#who'), /Carlos · Dono/);
  });
  await step('dono define início e prazo da conferência e vê o código da clínica', async () => {
    await nav(op, '#ajustes');
    await op.fill('#sd', '2026-11-26');
    await op.fill('#dl', '18:00');
    await op.click('#fs button');
    await synced(op);
    assert.equal(fake.tables.config[0].inicio, '2026-11-26');
    await nav(op, '#ajustes');
    code = (await op.textContent('#code')).trim();
    assert.equal(code, fake.tables.config[0].codigo_convite);
    await op.waitForSelector('#members .row');
    await shot(op, '08-ajustes-dono');
  });

  // ================= Celular do funcionário =================
  const { ctx, page } = await device('funcionario');
  await page.clock.install({ time: new Date('2026-11-26T09:00:00-03:00') });

  await step('funcionário com código errado não entra; com o código certo entra', async () => {
    await signup(page, { name: 'Bruna', email: 'bruna@teste.kf', code: 'ERRADO' });
    await page.getByText('Código da clínica inválido').waitFor();
    assert.equal(await page.textContent('h2'), 'Entrar na clínica');
    await page.fill('#nm', 'Bruna');
    await page.fill('#cd', code.toLowerCase());
    await page.click('#go');
    await waitHash(page, '#painel');
    assert.match(await page.textContent('#who'), /Bruna · Funcionário/);
    assert.equal(fake.tables.membros.find(m => m.nome === 'Bruna').papel, 'funcionario');
  });

  await step('senha errada é recusada no login', async () => {
    const tmp = await device('tmp');
    await tmp.page.goto(URL);
    await tmp.page.fill('#em', 'bruna@teste.kf');
    await tmp.page.fill('#pw', 'errada');
    await tmp.page.click('#go');
    await tmp.page.getByText('E-mail ou senha incorretos.').waitFor();
    await tmp.ctx.close();
  });

  await step('validação do cadastro', async () => {
    await nav(page, '#novo');
    await page.click('#save');
    assert.match(await page.textContent('#err'), /nome/);
    await page.fill('#nm', 'Teste');
    await page.fill('#qt', '2');
    await page.fill('#mn', '1');
    await page.click('#save');
    assert.match(await page.textContent('#err'), /categoria/);
    await page.fill('#ct', 'Insumos');
    await page.click('#save');
    assert.match(await page.textContent('#err'), /fornecedor/);
    assert.equal(await page.$eval('#fn', el => el.classList.contains('invalid')), true);
    await page.fill('#fn', 'Cremer');
    await page.fill('#mn', '0');
    await page.click('#save');
    assert.match(await page.textContent('#err'), /mínimo/);
    await page.fill('#mn', '1');
    await page.click('#save');
    assert.match(await page.textContent('#err'), /validade ou marque ND/);
    await page.check('#nd');
    assert.equal(await page.$eval('#vl', el => el.disabled), true);
    await page.uncheck('#nd');
    assert.ok(page.url().includes('#novo'), 'não pode salvar com campo faltando');
  });

  let r1, r2, r3;
  await step('cadastra produto com foto e gera desenho de traço', async () => {
    r1 = await addProduct(page, { name: 'Luva de procedimento M', qty: 10, min: 4, file: 'produto.jpg' });
    assert.deepEqual(r1.dims, { lw: 800, lh: 600, ow: 1200, oh: 900 });
    // desenho: fundo branco com traço escuro numa fração razoável da imagem
    const ink = await page.evaluate(async () => {
      const img = document.querySelector('#big');
      await img.decode();
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      let dark = 0, other = 0;
      for (let i = 0; i < d.length; i += 4) { if (d[i] < 128) dark++; if (d[i] !== d[i + 1] || (d[i] !== 255 && d[i] !== 30)) other++; }
      return { ratio: dark / (d.length / 4), other };
    });
    assert.ok(ink.ratio > 0.02 && ink.ratio < 0.25, 'proporção de traço ' + ink.ratio);
    assert.equal(ink.other, 0, 'desenho deve ser só preto e branco');
    await shot(page, '02-produto-desenho');
    await page.click('.toggle button[data-v=orig]');
    assert.equal(await page.evaluate(() => document.querySelector('#big').naturalWidth || 0) >= 0, true);
    await page.waitForFunction(() => document.querySelector('#big').naturalWidth === 1200);
    await shot(page, '03-produto-foto-original');
  });

  await step('foto de celular "em pé" (EXIF) sai na orientação certa', async () => {
    r2 = await addProduct(page, { name: 'Álcool 70% 1L', qty: 3, min: 5, file: 'produto-exif6.jpg', supplier: 'Farmácia', expiry: '2026-12-20' });
    assert.deepEqual(r2.dims, { lw: 800, lh: 600, ow: 1200, oh: 900 });
  });

  await step('foto grande (12 MP, 4032x3024) é processada', async () => {
    r3 = await addProduct(page, { name: 'Gaze estéril', qty: 20, min: 10, file: 'produto-grande.jpg', expiry: '2027-06-30' });
    assert.deepEqual(r3.dims, { lw: 800, lh: 600, ow: 1600, oh: 1200 });
    console.log('        tempo de conversão (12 MP, Chromium no servidor):', r3.ms, 'ms');
  });

  await step('nome duplicado é recusado', async () => {
    await nav(page, '#novo');
    await page.fill('#nm', 'gaze ESTÉRIL');
    await page.fill('#qt', '1'); await page.fill('#mn', '1');
    await page.click('#save');
    assert.match(await page.textContent('#err'), /Já existe/);
  });

  await step('produto abaixo do mínimo fica vermelho', async () => {
    await nav(page, '#estoque');
    await page.waitForSelector('#plist li');
    const low = await page.$$eval('li.prod.low .name', els => els.map(e => e.textContent));
    assert.deepEqual(low, ['Álcool 70% 1L']);
    assert.match(await page.textContent('#low-banner'), /1 produto abaixo do mínimo: Álcool 70% 1L/);
    const bg = await page.$eval('li.prod.low', el => getComputedStyle(el).borderColor);
    assert.equal(bg, 'rgb(224, 121, 111)');
    // vermelho vem primeiro na lista
    assert.equal(await page.$eval('#plist li', el => el.textContent.includes('Álcool')), true);
    await page.waitForFunction(() => [...document.querySelectorAll('img.thumb')].every(i => i.naturalWidth > 0));
    await shot(page, '04-lista-com-vermelho');
  });

  await step('botões + e − atualizam e tiram/colocam o vermelho', async () => {
    const li = () => page.locator('li.prod', { hasText: 'Álcool' });
    await li().locator('[data-act=inc]').click();
    await page.waitForFunction(() => document.querySelector('li.prod.low .n')?.textContent === '4');
    await li().locator('[data-act=inc]').click();
    await page.waitForFunction(() => !document.querySelector('li.prod.low'));
    assert.equal(await page.$('#low-banner'), null);
    await li().locator('[data-act=dec]').click();
    await page.waitForSelector('li.prod.low');
    assert.equal(await li().locator('.n').textContent(), '4');
  });

  await step('editar produto (mínimo) mantém a foto', async () => {
    const id = await page.locator('li.prod', { hasText: 'Gaze' }).getAttribute('data-id');
    await nav(page, '#editar/' + id);
    await page.waitForFunction(() => document.querySelector('#pv-line').naturalWidth > 0);
    await page.fill('#mn', '25');
    await page.click('#save');
    await waitHash(page, '#produto/');
    await page.getByText('Abaixo do mínimo: tem 20, mínimo 25.').waitFor();
    await page.waitForFunction(() => document.querySelector('#big').naturalWidth === 800);
    await nav(page, '#editar/' + id);
    await page.fill('#mn', '10');
    await page.click('#save');
    await waitHash(page, '#produto/');
  });

  await step('dia do cadastro: não bloqueia (produtos recém-cadastrados)', async () => {
    await nav(page, '#estoque');
    assert.equal(await page.$('nav a.disabled'), null);
    await nav(page, '#conferencia');
    await page.getByText('cadastrados hoje').waitFor();
  });

  await step('27/11 (sexta), dia útil: bloqueia as outras telas até contar', async () => {
    await setTime(page, '2026-11-27T08:00:00-03:00');
    await nav(page, '#estoque');
    await waitHash(page, '#conferencia');
    await page.getByText('Conte todos os produtos para liberar o app.').waitFor();
    assert.equal(await page.locator('nav a.disabled').count(), 3); // Painel, Estoque e Ajustes
    for (const h of ['#ajustes', '#novo', '#historico']) {
      await nav(page, h);
      await waitHash(page, '#conferencia');
    }
    // contagem cega: não mostra a quantidade do sistema
    const txt = await page.textContent('#clist');
    assert.ok(!/\b(10|4|20)\b/.test(txt), 'não deve mostrar quantidades: ' + txt);
    await page.waitForFunction(() => [...document.querySelectorAll('img.thumb')].every(i => i.naturalWidth > 0));
    await shot(page, '05-conferencia-bloqueada');
  });

  await step('rascunho da contagem sobrevive a fechar o app; só conclui com tudo contado', async () => {
    const inputs = page.locator('#clist input');
    await inputs.nth(0).fill('2');  // Álcool (ordem alfabética)
    await inputs.nth(1).fill('18'); // Gaze
    assert.equal(await page.isDisabled('#finish'), true);
    await page.reload();
    await page.waitForSelector('#clist');
    assert.equal(await inputs.nth(0).inputValue(), '2');
    assert.equal(await inputs.nth(1).inputValue(), '18');
    assert.equal(await page.textContent('#done-n'), '2');
    await inputs.nth(2).fill('10'); // Luva
    assert.equal(await page.isDisabled('#finish'), false);
    await page.click('#finish');
    await page.waitForFunction(() => location.hash === '#estoque');
    await page.evaluate(() => window.__app.idle());
    assert.equal(await page.$('nav a.disabled'), null);
    const q = await page.$$eval('li.prod', els => Object.fromEntries(els.map(e => [e.querySelector('.name').textContent, e.querySelector('.n').textContent])));
    assert.deepEqual(q, { 'Álcool 70% 1L': '2', 'Gaze estéril': '18', 'Luva de procedimento M': '10' });
  });

  await step('após concluir, não bloqueia de novo no mesmo dia nem ao reabrir', async () => {
    await page.reload();
    await page.waitForSelector('#plist');
    assert.ok(!page.url().includes('conferencia'));
  });

  await step('28/11 (sábado): fim de semana, sem conferência obrigatória', async () => {
    await setTime(page, '2026-11-28T09:00:00-03:00');
    await nav(page, '#estoque');
    await page.waitForSelector('#plist');
    assert.equal(await page.$('nav a.disabled'), null);
    await nav(page, '#conferencia');
    await page.getByText('Hoje é fim de semana: não há conferência obrigatória.').waitFor();
  });

  await step('30/11 às 19h sem conferência: ATRASADA e bloqueado', async () => {
    await setTime(page, '2026-11-30T19:00:00-03:00');
    await waitHash(page, '#conferencia');
    await page.getByText('Conferência atrasada: o prazo de hoje (18:00) já passou.').waitFor();
  });

  await step('01/12: dia útil perdido exige justificativa antes da contagem', async () => {
    await setTime(page, '2026-12-01T08:00:00-03:00');
    await waitHash(page, '#conferencia');
    await page.waitForSelector('#jt');
    assert.match(await page.textContent('#jdays'), /Segunda-feira, 30\/11\/2026/);
    await page.fill('#jt', 'curto');
    await page.click('#jsend');
    assert.match(await page.textContent('#jerr'), /pelo menos 10 letras/);
    await page.fill('#jt', 'Faltei por motivo de saúde.');
    await shot(page, '16-justificativa');
    await page.click('#jsend');
    await page.waitForSelector('#clist');
    const inputs = page.locator('#clist input');
    for (let i = 0; i < 3; i++) await inputs.nth(i).fill(String([2, 18, 9][i]));
    await page.click('#finish');
    await waitHash(page, '#estoque');
  });

  await step('produtos, fotos e quantidades do funcionário chegam no celular do dono', async () => {
    await synced(page);
    assert.equal(fake.tables.produtos.length, 3);
    assert.equal(fake.files.size, 6); // 3 originais + 3 desenhos
    await setTime(op, '2026-12-01T09:00:00-03:00');
    await synced(op);
    await nav(op, '#estoque');
    const q = await op.$$eval('li.prod', els => Object.fromEntries(els.map(e => [e.querySelector('.name').textContent, e.querySelector('.n').textContent])));
    assert.deepEqual(q, { 'Álcool 70% 1L': '2', 'Gaze estéril': '18', 'Luva de procedimento M': '9' });
    assert.deepEqual(await op.$$eval('li.prod.low .name', els => els.map(e => e.textContent)), ['Álcool 70% 1L']);
    await op.waitForFunction(() => [...document.querySelectorAll('img.thumb')].length === 3 && [...document.querySelectorAll('img.thumb')].every(i => i.naturalWidth === 800));
    await shot(op, '09-dono-recebeu-produtos');
  });

  await step('dono altera um produto e o funcionário recebe', async () => {
    const li = op.locator('li.prod', { hasText: 'Álcool' });
    await li.locator('[data-act=inc]').click();
    await li.locator('[data-act=inc]').click();
    await li.locator('[data-act=inc]').click();
    await op.waitForFunction(() => !document.querySelector('li.prod.low'));
    await synced(op);
    await setTime(page, '2026-12-01T09:05:00-03:00');
    await synced(page);
    await nav(page, '#estoque');
    assert.equal(await page.locator('li.prod', { hasText: 'Álcool' }).locator('.n').textContent(), '5');
    assert.equal(await page.$('li.prod.low'), null);
  });

  await step('sem internet: alteração fica guardada e é enviada quando a internet volta', async () => {
    await ctx.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    const li = page.locator('li.prod', { hasText: 'Gaze' });
    await li.locator('[data-act=dec]').click();
    await page.waitForFunction(() => /offline · 1 pendente/.test(document.querySelector('#sync')?.textContent || ''));
    await shot(page, '10-offline-pendente');
    assert.equal(fake.tables.produtos.find(p => p.nome === 'Gaze estéril').quantidade, 18);
    await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => /sincronizado/.test(document.querySelector('#sync')?.textContent || ''));
    assert.equal(fake.tables.produtos.find(p => p.nome === 'Gaze estéril').quantidade, 17);
  });

  await step('conflito: dois celulares mudam o mesmo produto, vale a alteração mais recente', async () => {
    await ctx.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.locator('li.prod', { hasText: 'Luva' }).locator('[data-act=inc]').click(); // 09:05 → 10
    await setTime(op, '2026-12-01T09:10:00-03:00');
    await nav(op, '#estoque');
    await op.locator('li.prod', { hasText: 'Luva' }).locator('[data-act=dec]').click();   // 09:10 → 8
    await synced(op);
    await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await synced(page);
    await nav(page, '#estoque');
    assert.equal(fake.tables.produtos.find(p => p.nome === 'Luva de procedimento M').quantidade, 8);
    assert.equal(await page.locator('li.prod', { hasText: 'Luva' }).locator('.n').textContent(), '8');
  });

  await step('produto excluído some nos dois celulares', async () => {
    const id = await op.locator('li.prod', { hasText: 'Gaze' }).getAttribute('data-id');
    await nav(op, '#produto/' + id);
    await op.click('#del');
    await waitHash(op, '#estoque');
    await synced(op);
    await synced(page);
    await nav(page, '#estoque');
    assert.equal(await page.locator('li.prod', { hasText: 'Gaze' }).count(), 0);
    assert.equal(fake.tables.produtos.find(p => p.id === id).excluido, true);
  });

  await step('dono troca o prazo e o funcionário passa a seguir o novo prazo', async () => {
    await nav(op, '#ajustes');
    await op.fill('#dl', '07:00');
    await op.click('#fs button');
    await synced(op);
    await setTime(page, '2026-12-02T08:00:00-03:00'); // dia de conferência, já passou das 07:00
    await synced(page);
    await page.evaluate(() => window.__app.render());
    await waitHash(page, '#conferencia');
    await page.getByText('Conferência atrasada: o prazo de hoje (07:00) já passou.').waitFor();
  });

  await step('dono vê quem conferiu e quando (vindo do celular do funcionário)', async () => {
    await setTime(op, '2026-12-01T20:00:00-03:00');
    await synced(op);
    const page = op;
    await nav(page, '#historico');
    await page.waitForSelector('table.hist');
    const rows = await page.$$eval('table.hist:first-of-type tbody tr', trs => trs.map(tr => [...tr.children].map(td => td.innerText.replace(/\s+/g, ' ').trim())));
    assert.equal(rows[0][0].startsWith('01/12/2026'), true);
    assert.equal(rows[0][1], 'Feita');
    assert.match(rows[0][2], /Bruna 01\/12\/2026/);
    assert.equal(rows[1][0].startsWith('30/11/2026'), true);
    assert.equal(rows[1][1], 'Justificada');
    assert.match(rows[1][2], /Bruna: “Faltei por motivo de saúde.”/);
    assert.equal(rows[2][0].startsWith('27/11/2026'), true);
    assert.equal(rows[2][1], 'Feita');
    assert.match(rows[2][2], /Bruna 27\/11\/2026/);
    assert.equal(rows[3][1], 'Sem cobrança (produtos novos)');
    const j = fake.tables.conferencias.find(c => c.justificativa);
    assert.deepEqual([j.justificativa, j.dias], ['Faltei por motivo de saúde.', ['2026-11-30']]);
    await page.click('summary');
    await shot(page, '06-historico-dono');
  });

  await step('dono vê aviso de conferência atrasada e nunca é bloqueado', async () => {
    await setTime(op, '2026-12-02T09:00:00-03:00');
    await synced(op);
    await nav(op, '#estoque');
    assert.ok(op.url().includes('#estoque'));
    await op.getByText('O prazo de hoje passou e o funcionário ainda não contou o estoque.').waitFor();
    await shot(op, '07-dono-aviso-atrasada');
  });

  await step('radar no painel: alerta, reposição por fornecedor e desenho sem foto', async () => {
    await nav(op, '#novo');
    await op.fill('#nm', 'Agulha 31G');
    await op.fill('#ct', 'Insumos');
    await op.fill('#fn', 'Mercado Livre');
    await op.fill('#qt', '0');
    await op.fill('#mn', '2');
    await op.check('#nd');
    await op.click('#save');
    await waitHash(op, '#produto/');
    await op.waitForSelector('.hero svg.ill');
    await op.getByText('Comprar pelo menos 2.').waitFor();
    await shot(op, '13-produto-sem-foto-desenho');
    await synced(op);
    const row = fake.tables.produtos.find(p => p.nome === 'Agulha 31G');
    assert.equal(row.fornecedor, 'Mercado Livre');
    assert.equal(row.categoria, 'Insumos');
    assert.equal(row.sem_validade, true);
    assert.equal(row.validade, null);
    assert.equal(fake.tables.produtos.find(p => p.nome === 'Álcool 70% 1L').validade, '2026-12-20');
    await nav(op, '#painel');
    await op.waitForFunction(() => document.querySelector('#radar-n')?.textContent === '1');
    assert.deepEqual(await op.$$eval('#alist li.prod .name', els => els.map(e => e.textContent)), ['Agulha 31G']);
    assert.equal(await op.locator('#alist li.prod .ping').count(), 1);
    assert.match(await op.textContent('#shop'), /Mercado Livre.*Agulha 31G.*comprar 2/s);
    await op.waitForFunction(() => { const p = document.querySelector('.ring .prog'); return p && Number(p.getAttribute('stroke-dashoffset')) < 527 && /\d/.test(document.querySelector('.ring .ctr b').textContent); });
    assert.match(await op.textContent('.contrib'), /Estoque acima do alerta.*Validade em dia.*Conferência diária.*Cadastro completo/s);
    await op.waitForTimeout(1600);
    await op.screenshot({ path: path.join(SHOTS, '11-painel-saude.png'), fullPage: true });
    await nav(op, '#estoque/alerta');
    assert.deepEqual(await op.$$eval('#plist li.prod .name', els => els.map(e => e.textContent)), ['Agulha 31G']);
    await shot(op, '12-estoque-filtro-alerta');
  });

  await step('validade: radar de vencimento, filtro e ND', async () => {
    await nav(op, '#painel');
    assert.deepEqual(await op.$$eval('#elist li.prod .name', els => els.map(e => e.textContent)), ['Álcool 70% 1L']);
    assert.match(await op.textContent('#elist .pill.exp'), /Vence em \d+ dias/);
    await op.waitForFunction(() => [...document.querySelectorAll('img.thumb')].every(i => i.naturalWidth > 0));
    await shot(op, '14-painel-validade');
    await nav(op, '#estoque/validade');
    assert.deepEqual(await op.$$eval('#plist li.prod .name', els => els.map(e => e.textContent)), ['Álcool 70% 1L']);
    const ag = fake.tables.produtos.find(p => p.nome === 'Agulha 31G').id;
    await nav(op, '#produto/' + ag);
    assert.equal(await op.textContent('#f-vl'), 'ND · sem validade');
    const gz = fake.tables.produtos.find(p => p.nome === 'Álcool 70% 1L').id;
    await nav(op, '#produto/' + gz);
    assert.match(await op.textContent('#f-vl'), /20\/12\/2026 · Vence em \d+ dias/);
    await shot(op, '15-produto-validade');
  });

  await step('dono tira o acesso do funcionário', async () => {
    await nav(op, '#ajustes');
    await op.waitForSelector('#members [data-rm]');
    await op.click('#members [data-rm]');
    await op.waitForFunction(() => !document.querySelector('#members [data-rm]'));
    assert.equal(fake.tables.membros.length, 1);
  });

  await step('quem perdeu o acesso é desconectado e os dados saem do celular', async () => {
    await page.evaluate(() => window.__app.cloud.requestSync());
    await page.getByText('Seu acesso a esta clínica foi retirado pelo dono.').waitFor();
    const left = await page.evaluate(() => new Promise(r => {
      const q = indexedDB.open('estoque-kf'); q.onsuccess = () => { const g = q.result.transaction('products').objectStore('products').count(); g.onsuccess = () => r(g.result); };
    }));
    assert.equal(left, 0);
  });

  await step('funciona sem internet depois de aberto uma vez', async () => {
    await page.evaluate(() => navigator.serviceWorker.ready);
    await nav(page, '#estoque');
    await page.reload(); // garante que o service worker controla a página
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await ctx.setOffline(true);
    await page.reload();
    await page.waitForSelector('#main h2');
    assert.match(await page.textContent('header .brand'), /Clínica KF/);
    await ctx.setOffline(false);
  });

  await step('manifesto válido para instalação (Chrome)', async () => {
    const cdp = await ctx.newCDPSession(page);
    const m = await cdp.send('Page.getAppManifest');
    assert.equal(m.errors.length, 0, JSON.stringify(m.errors));
    const inst = await cdp.send('Page.getInstallabilityErrors');
    assert.deepEqual(inst.installabilityErrors, []);
  });
  await ctx.close();

  await own.ctx.close();

  assert.deepEqual(errors, [], 'erros no console');
  console.log(`\nTODOS OS ${passed} PASSOS PASSARAM`);
} finally {
  await browser.close();
  server.kill();
}
