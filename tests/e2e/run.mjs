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
    const ci = name => page.locator('#clist li', { hasText: name }).locator('input');
    await ci('Álcool').fill('2');
    await ci('Gaze').fill('18');
    assert.equal(await page.isDisabled('#finish'), true);
    await page.reload();
    await page.waitForSelector('#clist');
    assert.equal(await ci('Álcool').inputValue(), '2');
    assert.equal(await ci('Gaze').inputValue(), '18');
    assert.equal(await page.textContent('#done-n'), '2');
    await ci('Luva').fill('10');
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
    for (const [n, v] of [['Álcool', 2], ['Gaze', 18], ['Luva', 9]]) await page.locator('#clist li', { hasText: n }).locator('input').fill(String(v));
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
    assert.match(rows[0][1], /^Feita Bruna 01\/12\/2026/);
    assert.equal(rows[1][0].startsWith('30/11/2026'), true);
    assert.match(rows[1][1], /^Justificada Bruna: “Faltei por motivo de saúde.”/);
    assert.equal(rows[2][0].startsWith('27/11/2026'), true);
    assert.match(rows[2][1], /^Feita Bruna 27\/11\/2026/);
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
    await op.waitForFunction(() => document.querySelectorAll('.radar .blip').length >= 1);
    assert.match(await op.textContent('.radar-card .since'), /dia útil sem conferir o estoque|Estoque conferido hoje|Conferência de hoje pendente/);
    console.log('       aviso do radar:', (await op.textContent('.radar-card .since')).replace(/\s+/g, ' ').trim());
    await shot(op, '11-painel-radar');
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

  // ================= versão 0.7 =================
  const prod = name => fake.tables.produtos.find(p => p.nome === name);
  await step('preço e código de barras no cadastro; movimentos chegam no servidor', async () => {
    const al = prod('Álcool 70% 1L');
    await nav(op, '#editar/' + al.id);
    await op.fill('#pr', '12,50');
    await op.fill('#bc', '7891234567895');
    await op.click('#save');
    await waitHash(op, '#produto/');
    await synced(op);
    assert.equal(Number(prod('Álcool 70% 1L').preco), 12.5);
    assert.equal(prod('Álcool 70% 1L').codigo_barras, '7891234567895');
    assert.match(await op.textContent('.facts'), /Preço unitário\s*R\$\s*12,50/);
    const tipos = new Set(fake.tables.movimentos.map(m => m.tipo));
    assert.ok(tipos.has('conferencia') && tipos.has('saida') && tipos.has('entrada'), 'tipos: ' + [...tipos].join(','));
    assert.ok(fake.tables.movimentos.every(m => m.por_user && m.por_nome));
  });

  await step('registrar entrada com validade cria lote e entra no gasto', async () => {
    const al = prod('Álcool 70% 1L');
    const before = Number(al.quantidade);
    await nav(op, '#produto/' + al.id);
    await op.fill('#in-q', '10');
    await op.fill('#in-d', '2027-03-10');
    await op.click('#in-f button[type=submit]');
    await op.waitForFunction(() => /2027|10\/03/.test(document.querySelector('ul.lots')?.textContent || ''));
    await synced(op);
    const a = prod('Álcool 70% 1L');
    assert.equal(a.quantidade, before + 10);
    assert.deepEqual(a.lotes.map(l => [l.validade, l.qtd]), [['2027-03-10', 10]]);
    const m = fake.tables.movimentos.filter(x => x.produto === 'Álcool 70% 1L' && x.tipo === 'entrada').pop();
    assert.deepEqual([m.delta, Number(m.preco)], [10, 12.5]);
    // as unidades antigas viram um lote vencido e são descartadas como perda
    await op.fill('#lot-d', '2026-11-30');
    await op.click('#lot-f button[type=submit]');
    await op.waitForSelector('[data-discard]');
    assert.match(await op.textContent('ul.lots li:first-child'), /Usar primeiro/);
    await shot(op, '16-lotes');
    await op.click('[data-discard]');
    await op.waitForFunction(() => !document.querySelector('[data-discard]'));
    await synced(op);
    const b = prod('Álcool 70% 1L');
    assert.equal(b.quantidade, 10);
    assert.equal(String(b.validade).slice(0, 10), '2027-03-10');
    assert.ok(fake.tables.movimentos.some(x => x.tipo === 'perda' && x.produto === 'Álcool 70% 1L' && x.delta === -before));
  });

  await step('pedido de compra: pedido feito, recebido com validade entra no estoque', async () => {
    await nav(op, '#painel');
    const grp = op.locator('.supplier', { hasText: 'Mercado Livre' });
    assert.match(await grp.locator('a', { hasText: 'WhatsApp' }).getAttribute('href'), /^https:\/\/wa\.me\/\?text=.*Agulha%2031G/);
    await grp.locator('[data-order]').click();
    await op.waitForSelector('.order-tag');
    await synced(op);
    const o = fake.tables.pedidos.find(x => x.fornecedor === 'Mercado Livre');
    assert.equal(o.status, 'feito');
    assert.equal(o.itens[0].nome, 'Agulha 31G');
    await op.click('.order-tag');
    await waitHash(op, '#pedido/');
    await op.waitForSelector('#rcv'); await op.waitForTimeout(900);
    await shot(op, '17-pedido');
    const agQ = prod('Agulha 31G').quantidade;
    const want = o.itens[0].qtd;
    // Agulha é ND: não pede validade
    await op.click('#rcv button[type=submit]');
    await waitHash(op, '#painel');
    await synced(op);
    assert.equal(fake.tables.pedidos.find(x => x.id === o.id).status, 'recebido');
    assert.equal(prod('Agulha 31G').quantidade, agQ + want);
    assert.ok(fake.tables.movimentos.some(x => x.pedido_id === o.id && x.tipo === 'entrada' && x.fornecedor === 'Mercado Livre'));
  });

  await step('leitor de código de barras abre o produto (Estoque) e acha o item (Conferência)', async () => {
    await nav(op, '#estoque');
    await op.evaluate(() => { window.__KF_FAKE_SCAN = '7891234567895'; });
    await op.click('#l-scan');
    await waitHash(op, '#produto/');
    assert.equal(await op.textContent('h2'), 'Álcool 70% 1L');
    await op.evaluate(() => { delete window.__KF_FAKE_SCAN; });
  });

  await step('código novo: sugere o nome pela base pública, liga a um produto ou cadastra um novo', async () => {
    // bases públicas imitadas: Open Food Facts conhece 7894900011517; as outras não conhecem nada
    await op.context().route(/open(food|beauty|products)facts\.org\/api\/v2\/product\//, route => {
      const u = route.request().url();
      if (u.includes('openfoodfacts') && u.includes('7894900011517'))
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({ status: 1, product: { product_name: 'LUVA NITRILICA AZUL', quantity: '100 un', brands: 'Marca Teste' } }) });
      return route.fulfill({ status: 404, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"status":0}' });
    });
    await op.setViewportSize({ width: 390, height: 844 });
    // 1) achou na base: mostra a sugestão e cadastra com o nome
    await nav(op, '#estoque');
    await op.evaluate(() => { window.__KF_FAKE_SCAN = '7894900011517'; });
    await op.click('#l-scan');
    await waitHash(op, '#codigo/7894900011517');
    await op.waitForSelector('.bc-found');
    assert.match(await op.textContent('.bc-found'), /Luva nitrilica azul 100 un.*Marca Teste · Open Food Facts/s);
    // a busca de produto existente já começa pela primeira palavra da sugestão
    assert.equal(await op.inputValue('#bl-q'), 'Luva');
    assert.match(await op.textContent('#bl-list'), /Luva de procedimento M/);
    await op.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
    await op.waitForTimeout(300);
    await op.screenshot({ path: path.join(SHOTS, 'qa', 'codigo-novo-sugestao.png') });
    await op.click('#bc-new');
    await waitHash(op, '#novo');
    assert.equal(await op.inputValue('#nm'), 'Luva nitrilica azul 100 un');
    assert.equal(await op.inputValue('#bc'), '7894900011517');
    assert.match(await op.textContent('#f'), /Nome sugerido pela base pública/);
    // 2) não achou: liga a um produto que já existe
    await nav(op, '#estoque');
    await op.evaluate(() => { window.__KF_FAKE_SCAN = '7890000000017'; });
    await op.click('#l-scan');
    await waitHash(op, '#codigo/7890000000017');
    await op.waitForFunction(() => /Não achei este código/.test(document.querySelector('#bc-sug')?.textContent || ''));
    await op.fill('#bl-q', 'agulha');
    await op.dispatchEvent('#bl-q', 'input');
    await op.click('#bl-list .bl-it');
    await waitHash(op, '#produto/');
    const ag = fake.tables.produtos.find(p => p.nome === 'Agulha 31G');
    await synced(op);
    assert.equal(fake.tables.produtos.find(p => p.id === ag.id).codigo_barras, '7890000000017');
    // 3) ler de novo o mesmo código abre o produto direto
    await nav(op, '#estoque');
    await op.evaluate(() => { window.__KF_FAKE_SCAN = '7890000000017'; });
    await op.click('#l-scan');
    await waitHash(op, '#produto/' + ag.id);
    await op.evaluate(() => { delete window.__KF_FAKE_SCAN; });
    await op.context().unroute(/open(food|beauty|products)facts\.org\/api\/v2\/product\//);
  });

  await step('relatórios: resumo do mês com gasto, perdas e fornecedores', async () => {
    await nav(op, '#historico');
    const t = (await op.textContent('main')).replace(/\s+/g, ' ');
    assert.match(t, /Resumo do mês/);
    assert.match(t, /Gasto no mês\s*R\$\s*125,00/);
    assert.match(t, /Perdas \(vencidos\)\s*R\$\s*\d/);
    assert.match(t, /Gasto por fornecedor/);
    await op.screenshot({ path: path.join(SHOTS, '18-relatorios.png'), fullPage: true });
    // tocar de novo na aba atual volta ao topo
    await op.evaluate(() => window.scrollTo(0, 900));
    await op.click('#tabs a[data-tab=historico]');
    await op.waitForFunction(() => window.scrollY === 0);
  });

  await step('preços: preencher de uma vez, salva na hora e sincroniza', async () => {
    await nav(op, '#historico');
    await op.click('.fill-prices');
    await waitHash(op, '#precos');
    const n0 = Number(await op.textContent('[data-n=falta]'));
    assert.ok(n0 >= 1, 'deveria haver produtos sem preço');
    const rows = op.locator('.pr-row');
    const first = await rows.nth(0).getAttribute('data-id');
    await rows.nth(0).locator('input').fill('3,2');
    await rows.nth(0).locator('input').press('Enter');
    await op.waitForFunction(() => /Salvo/.test(document.querySelector('.pr-row .st')?.textContent || ''));
    assert.equal(await op.evaluate(() => document.activeElement === document.querySelectorAll('.pr-row input')[1]), true, 'Enter passa para o próximo');
    assert.equal(await rows.nth(0).locator('input').inputValue(), '3,20');
    assert.equal(await op.textContent('[data-n=falta]'), String(n0 - 1));
    await rows.nth(1).locator('input').fill('abc');
    await rows.nth(1).locator('input').press('Tab');
    await op.waitForSelector('.pr-row.bad');
    await rows.nth(1).locator('input').fill('');
    await rows.nth(1).locator('input').press('Tab');
    await synced(op);
    assert.equal(Number(fake.tables.produtos.find(p => p.id === first).preco), 3.2);
    // preço novo: compara com o anterior (subiu) e mostra o histórico
    await op.click('#pf [data-f=todos]');
    const r0 = op.locator(`.pr-row[data-id="${first}"]`);
    await op.clock.runFor(60000); // um minuto depois
    await r0.locator('input').fill('4');
    await r0.locator('input').press('Tab');
    await op.waitForFunction(id => /Antes R\$\s*3,20.*▲\s*\+25%/.test(document.querySelector(`.pr-row[data-id="${id}"] .tr`)?.textContent || ''), first);
    assert.match(await op.textContent('#psum'), /▲ 1 subiu/);
    await r0.locator('.ph-tog').click();
    const hist = (await r0.locator('.ph-box').textContent()).replace(/\s+/g, ' ');
    assert.match(hist, /R\$\s*4,00\s*▲ \+25%/);
    assert.match(hist, /R\$\s*3,20/);
    await synced(op);
    assert.deepEqual(fake.tables.movimentos.filter(m => m.produto_id === first && m.tipo === 'preco').map(m => [Number(m.preco), m.delta]), [[3.2, 0], [4, 0]]);
    await op.click('#pf [data-f=subiu]');
    await op.waitForSelector('#pf [data-f=subiu].on');
    assert.equal(await op.locator('.pr-row').count(), 1);
    await r0.locator('.ph-tog').click();
    await op.screenshot({ path: path.join(SHOTS, '19-precos.png'), fullPage: true });
    await nav(op, '#produto/' + first);
    assert.match((await op.textContent('.price-hist')).replace(/\s+/g, ' '), /preço atualizado/);
    assert.match(await op.textContent('.facts'), /Antes R\$\s*3,20/);
  });

  await step('conferência rápida: mais usados primeiro e "Próximo" pula para o seguinte', async () => {
    // dois itens parados (sem uso no mês) para separar as seções
    for (const n of ['Campo cirúrgico', 'Fio de sutura']) {
      await nav(op, '#novo');
      await op.fill('#nm', n); await op.fill('#ct', 'Insumos'); await op.fill('#fn', 'Dental Cremer');
      await op.fill('#qt', '40'); await op.fill('#mn', '5'); await op.check('#nd');
      await op.click('#save'); await waitHash(op, '#produto/');
    }
    await nav(op, '#conferencia');
    if (await op.$('#extra')) await op.click('#extra');
    await op.waitForSelector('#clist input');
    const names = (await op.locator('#clist li .info').allTextContents()).map(t => t.replace(/\s+/g, ' ').trim());
    console.log('       ordem da contagem:', names.join(' | '));
    const secs = (await op.locator('.count-sec h3').allTextContents()).map(t => t.replace(/\s+/g, ' ').trim());
    assert.deepEqual(secs, ['Conferir primeiro 3', 'Pouco movimento 2']);
    assert.match(names[3], /^Campo cirúrgico/);
    await op.waitForTimeout(900); await op.screenshot({ path: path.join(SHOTS, '20-conferencia-ordem.png'), fullPage: true });
    const inputs = op.locator('#clist input');
    await inputs.nth(0).fill('1');
    await inputs.nth(0).press('Enter');
    assert.equal(await op.evaluate(() => document.activeElement === document.querySelectorAll('#clist input')[1]), true);
    await inputs.nth(0).fill('');
    await op.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('kf-contagem-')).forEach(k => localStorage.removeItem(k)));
  });

  await step('revisão visual: todas as telas no tamanho do iPhone (390x844)', async () => {
    mkdirSync(path.join(SHOTS, 'qa'), { recursive: true });
    const id = fake.tables.produtos.find(p => p.nome === 'Álcool 70% 1L').id;
    const screens = [['dono', op, ['#painel', '#estoque', '#estoque/alerta', '#produto/' + id, '#editar/' + id, '#novo', '#conferencia', '#historico', '#precos', '#ajustes']],
      ['func', page, ['#painel', '#estoque', '#conferencia', '#ajustes']]];
    for (const [who, pg, routes] of screens) {
      await pg.setViewportSize({ width: 390, height: 844 });
      for (const r of routes) {
        await nav(pg, r);
        await pg.waitForTimeout(900);
        // nada pode passar da largura da tela
        const over = await pg.evaluate(() => [...document.querySelectorAll('main *')].filter(e => { if (e.closest('.face-tap, .chips, .hscroll')) return false; const b = e.getBoundingClientRect(); return b.width && (b.right > innerWidth + 1 || b.left < -1); }).slice(0, 5).map(e => e.tagName + '.' + e.className + '#' + e.id));
        assert.deepEqual(over, [], `${who} ${r}: elementos passando da tela`);
        if (r.startsWith('#editar')) { await pg.evaluate(() => document.querySelector('.vrow, .lot-note').scrollIntoView({ block: 'center' })); await pg.waitForTimeout(300); await pg.screenshot({ path: path.join(SHOTS, 'qa', 'vrow.png') }); }
        await pg.screenshot({ path: path.join(SHOTS, 'qa', `${who}-${r.slice(1).replace(/\//g, '_').slice(0, 20)}.png`), fullPage: true });
      }
    }
  });

  await step('aviso do radar: 3 dias úteis sem conferir fica vermelho', async () => {
    const before = await op.evaluate(() => Date.now());
    await setTime(op, '2026-12-04T19:00:00-03:00'); // sexta depois do prazo; última contagem 01/12 (terça)
    await nav(op, '#painel');
    await op.waitForFunction(() => document.querySelector('.since')?.classList.contains('red'));
    assert.match(await op.textContent('.since .n'), /^3$/);
    const lu = fake.tables.produtos.find(p => p.nome === 'Agulha 31G');
    await nav(op, '#produto/' + lu.id);
    console.log('       consumo (Agulha 31G):', (await op.textContent('.stats')).replace(/\s+/g, ' ').trim().slice(0, 160));
    await nav(op, '#painel');
    await op.waitForTimeout(700);
    await op.screenshot({ path: path.join(SHOTS, 'qa', 'radar-3-dias.png'), clip: { x: 0, y: 0, width: 390, height: 844 } });
    await setTime(op, new Date(before).toISOString());
  });

  await step('pedido sugerido: produto acima do mínimo que vai acabar em breve entra na lista (previsão)', async () => {
    // Luva: 3 saídas por dia nos últimos 14 dias; com o estoque atual, acaba em poucos dias
    const prod = await op.evaluate(() => window.__app.S.products.find(p => p.name === 'Luva de procedimento M'));
    const q = Math.max(Number(prod.quantity), Number(prod.min) + 1);
    await op.evaluate(async ({ id, q }) => {
      const { db } = await import('./js/db.js');
      const p = await db.get('products', id);
      const t = Date.now(), day = 864e5;
      const per = Math.ceil(q / 4); // acaba em ~4 dias
      await db.put('products', { ...p, quantity: q, updatedAt: new Date().toISOString(), _dirty: true });
      for (let i = 14; i >= 1; i--) {
        await db.put('moves', { id: crypto.randomUUID(), productId: id, name: p.name, type: 'saida', delta: -per, before: q + per, after: q,
          price: null, supplier: p.supplier, orderId: null, note: 'teste', by: 'Teste', at: new Date(t - i * day).toISOString(), _dirty: true });
      }
    }, { id: prod.id, q });
    await op.reload(); await op.waitForFunction(() => !!window.__app); await op.evaluate(() => window.__app.idle());
    await nav(op, '#painel');
    const shop = (await op.textContent('#shop')).replace(/\s+/g, ' ');
    console.log('       pedido sugerido:', shop.slice(0, 260));
    assert.match(shop, /Luva de procedimento M\s*Previsão · tem \d+ · acaba em ~[1-4] dias · uso ~[\d,]+ por dia\s*comprar \d+/);
    assert.match(await op.textContent('.sub-lead'), /vai acabar em até 10 dias/);
    await op.setViewportSize({ width: 390, height: 844 });
    await op.evaluate(() => { document.querySelector('#shop').previousElementSibling.previousElementSibling.scrollIntoView({ block: 'start' }); scrollBy(0, -110); });
    await op.waitForTimeout(500);
    await op.screenshot({ path: path.join(SHOTS, 'qa', 'pedido-sugerido.png') });
  });

  await step('busca: ao digitar mostra a prévia dos produtos (sem acento) e abre o produto', async () => {
    await op.setViewportSize({ width: 390, height: 844 });
    await nav(op, '#estoque');
    await op.click('#q');
    await op.type('#q', 'alc', { delay: 60 });
    await op.waitForSelector('#q-sug:not(.hidden) a.sg');
    const first = await op.textContent('#q-sug a.sg');
    assert.match(first, /Álcool 70% 1L/);
    assert.equal(await op.textContent('#q-sug a.sg mark'), 'Álc');
    await op.waitForTimeout(300);
    await op.screenshot({ path: path.join(SHOTS, 'qa', 'busca-previa.png') });
    // lista abaixo também filtra
    const visible = await op.$$eval('#plist li:not(.hidden) .name', els => els.map(e => e.textContent));
    assert.deepEqual(visible, ['Álcool 70% 1L']);
    // nada encontrado
    await op.fill('#q', 'zzz'); await op.dispatchEvent('#q', 'input');
    assert.match(await op.textContent('#q-sug'), /Nenhum produto com “zzz”/);
    // tocar na sugestão abre o produto
    await op.fill('#q', 'agu'); await op.dispatchEvent('#q', 'input');
    await op.waitForSelector('#q-sug a.sg');
    const id = await op.getAttribute('#q-sug a.sg', 'data-id');
    await op.click('#q-sug a.sg');
    await waitHash(op, '#produto/' + id);
    await nav(op, '#estoque');
    await op.fill('#q', ''); await op.dispatchEvent('#q', 'input');
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
