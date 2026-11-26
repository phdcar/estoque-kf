// Teste ponta a ponta no Chromium (emulando celular Android) com relógio controlado.
// Uso: node tests/e2e/run.mjs   (gera capturas em tests/e2e/shots/)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
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
async function device(label) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`[${label}] ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`[${label}] console: ${m.text()}`); });
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
const setTime = async (page, iso) => { await page.clock.setSystemTime(new Date(iso)); await page.reload(); await page.waitForFunction(() => !!window.__app); await page.evaluate(() => window.__app.idle()); };

async function addProduct(page, { name, qty, min, file }) {
  await nav(page, '#novo');
  await page.fill('#nm', name);
  await page.fill('#qt', String(qty));
  await page.fill('#mn', String(min));
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
  // ================= Celular do funcionário =================
  const { ctx, page } = await device('funcionario');
  await page.clock.install({ time: new Date('2026-11-26T09:00:00-03:00') }); // quinta, dia de conferência

  await step('primeiro acesso: escolhe perfil funcionário', async () => {
    await page.goto(URL);
    await page.getByText('Quem vai usar este celular?').waitFor();
    await shot(page, '01-primeiro-acesso');
    await page.click('#be-staff');
    await page.fill('#nm', 'Bruna');
    await page.click('button[type=submit]');
    await page.getByText('Nenhum produto cadastrado ainda.').waitFor();
    assert.match(await page.textContent('#who'), /Bruna/);
  });

  await step('validação do cadastro', async () => {
    await nav(page, '#novo');
    await page.click('#save');
    assert.match(await page.textContent('#err'), /nome/);
    await page.fill('#nm', 'Teste');
    await page.fill('#qt', '2');
    await page.fill('#mn', '1');
    await page.click('#save');
    assert.match(await page.textContent('#err'), /foto/);
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
    r2 = await addProduct(page, { name: 'Álcool 70% 1L', qty: 3, min: 5, file: 'produto-exif6.jpg' });
    assert.deepEqual(r2.dims, { lw: 800, lh: 600, ow: 1200, oh: 900 });
  });

  await step('foto grande (12 MP, 4032x3024) é processada', async () => {
    r3 = await addProduct(page, { name: 'Gaze estéril', qty: 20, min: 10, file: 'produto-grande.jpg' });
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
    assert.equal(bg, 'rgb(198, 40, 40)');
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
    await page.getByText('recém-cadastrados').waitFor();
  });

  await step('dia seguinte (27/11, sexta): não é dia de conferência, livre', async () => {
    await setTime(page, '2026-11-27T09:00:00-03:00');
    await nav(page, '#estoque');
    await page.waitForSelector('#plist');
    assert.equal(await page.$('nav a.disabled'), null);
  });

  await step('28/11 (sábado), dia de conferência: bloqueia as outras telas', async () => {
    await setTime(page, '2026-11-28T08:00:00-03:00');
    await nav(page, '#estoque');
    await waitHash(page, '#conferencia');
    await page.getByText('Conte todos os produtos para liberar o app.').waitFor();
    assert.equal(await page.locator('nav a.disabled').count(), 2); // Estoque e Ajustes
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

  await step('30/11 às 19h sem conferência: ATRASADA e bloqueado', async () => {
    await setTime(page, '2026-11-30T19:00:00-03:00');
    await waitHash(page, '#conferencia');
    await page.getByText('Conferência atrasada (dia 30/11/2026).').waitFor();
  });

  await step('01/12: conferência de ontem não feita continua cobrando', async () => {
    await setTime(page, '2026-12-01T08:00:00-03:00');
    await waitHash(page, '#conferencia');
    const inputs = page.locator('#clist input');
    for (let i = 0; i < 3; i++) await inputs.nth(i).fill(String([2, 18, 9][i]));
    await page.click('#finish');
    await waitHash(page, '#estoque');
  });

  await step('funcionário não entra como dono sem senha certa', async () => {
    await nav(page, '#ajustes');
    page.__dialogAnswer = '1234'; // este celular não tem senha: cria
    await page.click('#switch');
    await page.waitForFunction(() => document.querySelector('#who').textContent.includes('Dono'));
    // volta a funcionário e tenta senha errada
    await nav(page, '#ajustes');
    page.__dialogAnswer = undefined;
    await page.click('#switch');
    await page.waitForFunction(() => document.querySelector('#who').textContent.includes('Funcionário'));
    await nav(page, '#ajustes');
    page.__dialogAnswer = '9999';
    await page.click('#switch');
    await page.getByText('Senha incorreta').waitFor();
    assert.match(await page.textContent('#who'), /Funcionário/);
    page.__dialogAnswer = '1234';
    await page.click('#switch');
    await page.waitForFunction(() => document.querySelector('#who').textContent.includes('Dono'));
  });

  await step('dono vê quem conferiu e quando, e dias perdidos', async () => {
    await nav(page, '#historico');
    await page.waitForSelector('table.hist');
    const rows = await page.$$eval('table.hist:first-of-type tbody tr', trs => trs.map(tr => [...tr.children].map(td => td.innerText.replace(/\s+/g, ' ').trim())));
    assert.equal(rows[0][0].startsWith('30/11/2026'), true);
    assert.equal(rows[0][1], 'Feita com atraso');
    assert.match(rows[0][2], /Bruna 01\/12\/2026/);
    assert.equal(rows[1][1], 'Feita');
    assert.match(rows[1][2], /Bruna 28\/11\/2026/);
    assert.equal(rows[2][1], 'Sem cobrança (produtos novos)');
    await page.click('summary');
    await shot(page, '06-historico-dono');
  });

  await step('funciona sem internet depois de aberto uma vez', async () => {
    await page.evaluate(() => navigator.serviceWorker.ready);
    await nav(page, '#estoque');
    await page.reload(); // garante que o service worker controla a página
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await ctx.setOffline(true);
    await page.reload();
    await page.waitForSelector('#plist');
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

  // ================= Celular do dono =================
  const own = await device('dono');
  const op = own.page;
  await op.clock.install({ time: new Date('2026-11-26T09:00:00-03:00') });
  await step('dono configura senha, início e horário; nunca é bloqueado', async () => {
    await op.goto(URL);
    await op.click('#be-owner');
    await op.fill('#nm', 'Carlos');
    await op.fill('#pin', '4321');
    await op.fill('#sd', '2026-11-26');
    await op.fill('#dl', '12:00');
    await op.click('button[type=submit]');
    await op.waitForSelector('#tabs:not(.hidden)');
    await addProduct(op, { name: 'Seringa 5ml', qty: 50, min: 20, file: 'produto.jpg' });
    await setTime(op, '2026-11-28T13:00:00-03:00');
    await nav(op, '#estoque');
    await op.waitForSelector('#plist');
    assert.ok(op.url().includes('#estoque'));
    await op.getByText('Conferência ATRASADA (dia 28/11/2026). O funcionário ainda não contou o estoque.').waitFor();
    await shot(op, '07-dono-aviso-atrasada');
  });
  await own.ctx.close();

  assert.deepEqual(errors, [], 'erros no console');
  console.log(`\nTODOS OS ${passed} PASSOS PASSARAM`);
} finally {
  await browser.close();
  server.kill();
}
