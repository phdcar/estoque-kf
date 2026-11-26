import { db } from './db.js';
import { processPhoto } from './lineart.js';
import { ymd, countStatus, history, isCountDay } from './schedule.js';
import * as cloud from './cloud.js';

export const APP_VERSION = '0.2.0';

// ---------- utilidades ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    }));
const fmtDay = s => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
const WEEK = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const weekday = s => { const [y, m, d] = s.split('-').map(Number); return WEEK[new Date(y, m - 1, d).getDay()]; };
const fmtTime = iso => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const fmtDateTime = iso => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const isLow = p => Number(p.quantity) < Number(p.min);
const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });

function toast(msg) {
  for (const old of $$('.toast')) old.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function overlay(msg) {
  const o = document.createElement('div');
  o.className = 'overlay';
  o.textContent = msg;
  document.body.appendChild(o);
  return () => o.remove();
}

const now = () => new Date();

// ---------- estado ----------
const S = {
  profile: null,          // { role: 'dono' | 'funcionario', name }
  schedule: null,         // { startDate: 'AAAA-MM-DD', deadline: 'HH:MM' }
  products: [],
  counts: [],
  thumbs: new Map(),      // id -> { line, orig, key } (URLs de objeto)
};

async function load() {
  S.profile = await db.get('settings', 'profile') || null;
  S.schedule = await db.get('settings', 'schedule') || null;
  S.products = (await db.all('products')).filter(p => !p.deleted);
  S.counts = await db.all('counts');
}

async function photoUrls(p) {
  if (!p.photoKey) return null;
  const cached = S.thumbs.get(p.id);
  if (cached && cached.key === p.photoKey) return cached;
  const rec = await db.get('photos', p.id);
  if (!rec) return null;
  if (cached) { URL.revokeObjectURL(cached.line); URL.revokeObjectURL(cached.orig); }
  const urls = { key: p.photoKey, line: URL.createObjectURL(rec.lineart), orig: URL.createObjectURL(rec.original) };
  S.thumbs.set(p.id, urls);
  return urls;
}

async function fillThumbs(root) {
  for (const img of $$('img[data-thumb]', root)) {
    const p = S.products.find(x => x.id === img.dataset.thumb);
    const u = p && await photoUrls(p);
    if (u) img.src = img.dataset.kind === 'orig' ? u.orig : u.line;
  }
}

function status() {
  return countStatus({
    now: now(),
    start: S.schedule?.startDate || ymd(now()),
    deadline: S.schedule?.deadline || '18:00',
    counts: S.counts,
    productCount: S.products.length,
    productDays: S.products.map(p => ymd(new Date(p.createdAt))),
  });
}

const isOwner = () => S.profile?.role === 'dono';
const locked = () => !isOwner() && status().locked;

// ---------- navegação ----------
const main = () => $('#main');

function route() {
  const h = location.hash.replace(/^#\/?/, '') || 'estoque';
  const [name, arg] = h.split('/');
  return { name, arg };
}

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function renderChrome(r) {
  $('#who').innerHTML = S.profile
    ? `${esc(S.profile.name)} · ${isOwner() ? 'Dono' : 'Funcionário'}<br><span id="sync"></span>` : '';
  renderSyncBadge();
  const tabs = $('#tabs');
  if (!S.profile) { tabs.classList.add('hidden'); return; }
  tabs.classList.remove('hidden');
  const lk = locked();
  const st = status();
  const countIco = st.locked ? '⚠️' : '✅';
  const items = [
    ['estoque', '📦', 'Estoque'],
    ['conferencia', countIco, 'Conferência'],
    ...(isOwner() ? [['historico', '🗓️', 'Histórico']] : []),
    ['ajustes', '⚙️', 'Ajustes'],
  ];
  tabs.innerHTML = items.map(([k, ico, label]) =>
    `<a href="#${k}" class="${r.name === k || (k === 'estoque' && ['produto', 'novo', 'editar'].includes(r.name)) ? 'on' : ''} ${lk && k !== 'conferencia' ? 'disabled' : ''}" data-tab="${k}">
      <span class="ico">${ico}</span>${label}</a>`).join('');
}

let rendering = Promise.resolve();
function render() {
  rendering = rendering.then(doRender).catch(err => {
    console.error(err);
    main().innerHTML = `<div class="banner red">Erro: ${esc(err.message)}</div>`;
  });
  return rendering;
}

async function doRender() {
  await load();
  let r = route();
  if (!S.profile) { renderChrome(r); return viewSetup(); }
  // bloqueio: nos dias de conferência o funcionário só acessa a tela de conferência
  if (locked() && r.name !== 'conferencia') {
    history_replace('#conferencia');
    r = route();
  }
  renderChrome(r);
  window.scrollTo(0, 0);
  switch (r.name) {
    case 'novo': return viewForm(null);
    case 'editar': return viewForm(r.arg);
    case 'produto': return viewProduct(r.arg);
    case 'conferencia': return viewCount();
    case 'historico': return isOwner() ? viewHistory() : viewList();
    case 'ajustes': return viewSettings();
    default: return viewList();
  }
}

function history_replace(hash) {
  window.history.replaceState(null, '', hash);
}

// ---------- tela: entrar / criar conta ----------
async function finishLogin(member) {
  // dados guardados antes da sincronização (etapa 1) neste celular
  if (!(await db.get('settings', 'cloudLinked'))) {
    const old = (await db.all('products')).filter(p => !p.deleted);
    if (old.length && confirm(`Este celular tem ${old.length} produto(s) cadastrado(s) antes da sincronização.\n\nOK: enviar para a nuvem.\nCancelar: apagar deste celular.`)) {
      for (const p of old) await db.put('products', { ...p, _dirty: true, _photoDirty: !!p.photoKey });
    } else {
      await db.clearData();
    }
    await db.clearStore('counts'); // contagens antigas eram de teste
    await db.put('settings', true, 'cloudLinked');
  }
  await db.put('settings', { role: member.papel, name: member.nome, userId: member.user_id, email: member.email }, 'profile');
  cloud.startAuto();
  await cloud.requestSync();
  go('#estoque');
}

function viewSetup(mode = 'entrar', info = '') {
  if (!cloud.configured()) {
    main().innerHTML = `<div class="banner red">O app ainda não está ligado ao servidor (falta a chave do Supabase).</div>`;
    return;
  }
  const tabs = `<div class="toggle">
      <button class="secondary ${mode === 'entrar' ? 'on' : ''}" data-m="entrar">Entrar</button>
      <button class="secondary ${mode === 'criar' ? 'on' : ''}" data-m="criar">Criar conta</button>
    </div>`;
  if (mode === 'entrar') {
    main().innerHTML = `
      <h2>Bem-vindo!</h2>
      ${tabs}
      ${info ? `<div class="banner green">${info}</div>` : ''}
      <form id="f" autocomplete="on">
        <label for="em">E-mail</label>
        <input id="em" type="email" autocomplete="username" required>
        <label for="pw">Senha</label>
        <input id="pw" type="password" autocomplete="current-password" required>
        <div id="err" class="banner red hidden" style="margin-top:12px"></div>
        <p><button class="block" type="submit" id="go">Entrar</button></p>
      </form>`;
  } else if (mode === 'criar') {
    main().innerHTML = `
      <h2>Criar conta</h2>
      ${tabs}
      <form id="f" autocomplete="on">
        <label for="nm">Seu nome</label>
        <input id="nm" type="text" maxlength="60" required placeholder="Ex.: Ana">
        <label for="em">E-mail</label>
        <input id="em" type="email" autocomplete="username" required>
        <label for="pw">Senha (mínimo 6 caracteres)</label>
        <input id="pw" type="password" autocomplete="new-password" minlength="6" required>
        <label for="cd">Código da clínica</label>
        <input id="cd" type="text" maxlength="12" autocapitalize="characters" placeholder="Peça ao dono">
        <p class="small muted">Funcionário: use o código que aparece nos Ajustes do celular do dono.<br>
        Dono: deixe em branco ao criar a primeira conta da clínica.</p>
        <div id="err" class="banner red hidden" style="margin-top:12px"></div>
        <p><button class="block" type="submit" id="go">Criar conta</button></p>
      </form>`;
  } else { // logado, mas ainda não faz parte da clínica
    main().innerHTML = `
      <h2>Entrar na clínica</h2>
      <form id="f">
        <label for="nm">Seu nome</label>
        <input id="nm" type="text" maxlength="60" required>
        <label for="cd">Código da clínica</label>
        <input id="cd" type="text" maxlength="12" autocapitalize="characters" placeholder="Peça ao dono">
        <div id="err" class="banner red ${info ? '' : 'hidden'}" style="margin-top:12px">${esc(info)}</div>
        <p><button class="block" type="submit" id="go">Continuar</button></p>
        <p><button class="block secondary" type="button" id="out">Sair desta conta</button></p>
      </form>`;
    $('#out').onclick = async () => { await cloud.signOut(); viewSetup(); };
  }
  $$('.toggle button').forEach(b => { b.onclick = () => viewSetup(b.dataset.m); });
  const showErr = m => { const el = $('#err'); el.textContent = m; el.classList.toggle('hidden', !m); };
  $('#f').onsubmit = async e => {
    e.preventDefault();
    showErr('');
    const btn = $('#go');
    btn.disabled = true;
    let created = false;
    try {
      if (mode === 'entrar') {
        await cloud.signIn($('#em').value.trim(), $('#pw').value);
        const m = await cloud.myMembership();
        if (!m) return viewSetup('entrar-clinica');
        return await finishLogin(m);
      }
      const name = $('#nm').value.trim();
      if (!name) throw new Error('Informe seu nome.');
      if (mode === 'criar') {
        const r = await cloud.signUp($('#em').value.trim(), $('#pw').value, name);
        if (r.needsConfirm) return viewSetup('entrar', 'Conta criada. Abra o e-mail de confirmação que enviamos e depois entre aqui.');
        created = true;
      }
      const m = await cloud.join(name, $('#cd')?.value.trim());
      await finishLogin(m);
    } catch (err) {
      // conta criada, mas o código da clínica estava errado: pede só o código de novo
      if (created) return viewSetup('entrar-clinica', cloud.errorText(err));
      showErr(cloud.errorText(err));
    } finally { if (document.body.contains(btn)) btn.disabled = false; }
  };
}

// ---------- tela: lista de produtos ----------
let searchTerm = '';

function countBanner() {
  const st = status();
  if (st.state === 'atrasada') {
    return `<a href="#conferencia" class="banner red" style="display:block;text-decoration:none">⚠️ Conferência ATRASADA (dia ${fmtDay(st.due)}). ${isOwner() ? 'O funcionário ainda não contou o estoque.' : 'Faça a contagem agora.'}</a>`;
  }
  if (st.state === 'pendente') {
    return `<a href="#conferencia" class="banner amber" style="display:block;text-decoration:none">Hoje é dia de conferência. Prazo até ${esc(S.schedule?.deadline || '18:00')}.</a>`;
  }
  if (st.state === 'feita' && isOwner() && st.due === st.today) {
    return `<div class="banner green">Conferência de hoje feita por ${esc(st.count.by)} às ${fmtTime(st.count.at)}.</div>`;
  }
  return '';
}

async function viewList() {
  const low = S.products.filter(isLow);
  const term = searchTerm.trim().toLowerCase();
  const items = S.products
    .filter(p => !term || p.name.toLowerCase().includes(term))
    .sort((a, b) => (isLow(b) - isLow(a)) || byName(a, b));
  main().innerHTML = `
    ${countBanner()}
    ${low.length ? `<div class="banner red" id="low-banner">🔴 ${low.length} ${low.length === 1 ? 'produto abaixo' : 'produtos abaixo'} do mínimo: ${low.map(p => esc(p.name)).join(', ')}</div>` : ''}
    <h2>Estoque <span class="muted small">(${S.products.length} ${S.products.length === 1 ? 'produto' : 'produtos'})</span></h2>
    ${S.products.length > 5 ? `<input type="search" class="search" id="q" placeholder="Buscar produto" value="${esc(searchTerm)}">` : ''}
    ${S.products.length === 0 ? `<div class="card"><p>Nenhum produto cadastrado ainda.</p><p>Toque em <b>+ Produto</b> para cadastrar o primeiro.</p></div>` : ''}
    <ul class="list" id="plist">
      ${items.map(p => `
        <li class="prod ${isLow(p) ? 'low' : ''}" data-id="${p.id}">
          <a href="#produto/${p.id}">${p.photoKey ? `<img class="thumb" alt="" data-thumb="${p.id}">` : `<div class="thumb empty">📦</div>`}</a>
          <div class="info">
            <a class="name" href="#produto/${p.id}">${esc(p.name)}</a>
            <div class="meta">Mínimo: ${p.min}</div>
            ${isLow(p) ? `<span class="badge">Abaixo do mínimo</span>` : ''}
          </div>
          <div class="qty">
            <button class="secondary" data-act="dec" aria-label="Diminuir">−</button>
            <span class="n">${p.quantity}</span>
            <button class="secondary" data-act="inc" aria-label="Aumentar">+</button>
          </div>
        </li>`).join('')}
    </ul>
    <a href="#novo" class="btn fab" id="add">+ Produto</a>`;
  const q = $('#q');
  if (q) q.oninput = () => {
    searchTerm = q.value;
    const t = searchTerm.trim().toLowerCase();
    $$('#plist li').forEach(li => {
      const p = S.products.find(x => x.id === li.dataset.id);
      li.classList.toggle('hidden', !!t && !p.name.toLowerCase().includes(t));
    });
  };
  $('#plist').onclick = async e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const id = b.closest('li').dataset.id;
    const p = await db.get('products', id);
    const delta = b.dataset.act === 'inc' ? 1 : -1;
    if (p.quantity + delta < 0) return;
    p.quantity += delta;
    p.updatedAt = new Date().toISOString();
    p.updatedBy = S.profile.name;
    p._dirty = true;
    await db.put('products', p);
    cloud.syncSoon();
    render();
  };
  await fillThumbs(main());
}

// ---------- tela: detalhe do produto ----------
async function viewProduct(id) {
  const p = S.products.find(x => x.id === id);
  if (!p) return go('#estoque');
  const u = await photoUrls(p);
  main().innerHTML = `
    <p><a href="#estoque">← Voltar</a></p>
    <h2>${esc(p.name)}</h2>
    ${isLow(p) ? `<div class="banner red">🔴 Abaixo do mínimo: tem ${p.quantity}, mínimo ${p.min}.</div>` : ''}
    ${u ? `
      <img class="big-img" id="big" src="${u.line}" alt="Desenho do produto">
      <div class="toggle">
        <button class="secondary on" data-v="line">Desenho</button>
        <button class="secondary" data-v="orig">Foto original</button>
      </div>` : `<div class="card muted">Sem foto.</div>`}
    <div class="card">
      <div class="row"><div><div class="muted small">Quantidade</div><div style="font-size:28px;font-weight:700" class="${isLow(p) ? 'st bad' : ''}">${p.quantity}</div></div>
      <div><div class="muted small">Estoque mínimo</div><div style="font-size:28px;font-weight:700">${p.min}</div></div></div>
      <p class="small muted">Atualizado em ${fmtDateTime(p.updatedAt)}${p.updatedBy ? ' por ' + esc(p.updatedBy) : ''}</p>
    </div>
    <p><a class="btn block" href="#editar/${p.id}">Editar produto</a></p>
    <p><button class="block danger" id="del">Excluir produto</button></p>`;
  if (u) {
    $$('.toggle button').forEach(b => b.onclick = () => {
      $$('.toggle button').forEach(x => x.classList.toggle('on', x === b));
      $('#big').src = b.dataset.v === 'orig' ? u.orig : u.line;
    });
  }
  $('#del').onclick = async () => {
    if (!confirm(`Excluir "${p.name}"? Isso não pode ser desfeito.`)) return;
    const cur = await db.get('products', p.id);
    await db.put('products', { ...cur, deleted: true, updatedAt: new Date().toISOString(), updatedBy: S.profile.name, _dirty: true });
    await db.del('photos', p.id);
    cloud.syncSoon();
    toast('Produto excluído');
    go('#estoque');
  };
}

// ---------- tela: cadastro / edição ----------
async function viewForm(id) {
  const p = id ? S.products.find(x => x.id === id) : null;
  if (id && !p) return go('#estoque');
  let newPhoto = null; // { original, lineart }
  const existing = p ? await photoUrls(p) : null;
  main().innerHTML = `
    <p><a href="${p ? '#produto/' + p.id : '#estoque'}">← Voltar</a></p>
    <h2>${p ? 'Editar produto' : 'Novo produto'}</h2>
    <form id="f" autocomplete="off" novalidate>
      <label for="nm">Nome do produto</label>
      <input id="nm" type="text" maxlength="80" value="${esc(p?.name || '')}" placeholder="Ex.: Luva de procedimento M">
      <div class="row">
        <div><label for="qt">Quantidade</label>
          <input id="qt" type="number" inputmode="numeric" min="0" step="1" value="${p ? p.quantity : ''}"></div>
        <div><label for="mn">Estoque mínimo</label>
          <input id="mn" type="number" inputmode="numeric" min="0" step="1" value="${p ? p.min : ''}"></div>
      </div>
      <label>Foto</label>
      <div class="row">
        <button type="button" class="secondary" id="cam">📷 Tirar foto</button>
        <button type="button" class="secondary" id="gal">🖼️ Da galeria</button>
      </div>
      <input type="file" id="f-cam" accept="image/*" capture="environment" class="hidden">
      <input type="file" id="f-gal" accept="image/*" class="hidden">
      <div class="photos ${existing ? '' : 'hidden'}" id="pv">
        <figure><img id="pv-line" src="${existing?.line || ''}" alt=""><figcaption>Desenho de traço</figcaption></figure>
        <figure><img id="pv-orig" src="${existing?.orig || ''}" alt=""><figcaption>Foto original</figcaption></figure>
      </div>
      <div id="err" class="banner red hidden" style="margin-top:12px"></div>
      <p style="margin-top:16px"><button class="block" type="submit" id="save">Salvar</button></p>
    </form>`;
  $('#cam').onclick = () => $('#f-cam').click();
  $('#gal').onclick = () => $('#f-gal').click();
  const onFile = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const done = overlay('Transformando a foto em desenho…');
    try {
      newPhoto = await processPhoto(file);
      $('#pv-line').src = URL.createObjectURL(newPhoto.lineart);
      $('#pv-orig').src = URL.createObjectURL(newPhoto.original);
      $('#pv').classList.remove('hidden');
    } catch (err) {
      showErr('Não foi possível usar essa foto: ' + err.message);
    } finally { done(); }
  };
  $('#f-cam').onchange = onFile;
  $('#f-gal').onchange = onFile;
  const showErr = m => { const el = $('#err'); el.textContent = m; el.classList.remove('hidden'); };
  $('#f').onsubmit = async e => {
    e.preventDefault();
    const name = $('#nm').value.trim();
    const qt = $('#qt').value.trim(), mn = $('#mn').value.trim();
    if (!name) return showErr('Informe o nome do produto.');
    if (!/^\d+$/.test(qt)) return showErr('Informe a quantidade (número inteiro, 0 ou mais).');
    if (!/^\d+$/.test(mn)) return showErr('Informe o estoque mínimo (número inteiro, 0 ou mais).');
    const dup = S.products.find(x => x.id !== p?.id && x.name.trim().toLowerCase() === name.toLowerCase());
    if (dup) return showErr(`Já existe um produto chamado "${dup.name}".`);
    if (!p && !newPhoto) return showErr('Tire ou escolha uma foto do produto.');
    $('#save').disabled = true;
    const ts = new Date().toISOString();
    const rec = p ? { ...p } : { id: uuid(), createdAt: ts, createdBy: S.profile.name };
    Object.assign(rec, { name, quantity: Number(qt), min: Number(mn), updatedAt: ts, updatedBy: S.profile.name });
    rec._dirty = true;
    if (newPhoto) {
      rec._photoDirty = true;
      rec.photoKey = uuid();
      await db.put('photos', { id: rec.id, original: newPhoto.original, lineart: newPhoto.lineart, key: rec.photoKey });
    }
    await db.put('products', rec);
    cloud.syncSoon();
    toast(p ? 'Produto atualizado' : 'Produto cadastrado');
    go('#produto/' + rec.id);
  };
}

// ---------- tela: conferência ----------
const draftKey = () => 'kf-contagem-' + ymd(now());
function loadDraft() { try { return JSON.parse(localStorage.getItem(draftKey()) || '{}'); } catch { return {}; } }
function saveDraft(d) { try { localStorage.setItem(draftKey(), JSON.stringify(d)); } catch { /* sem espaço */ } }

async function viewCount(forceStart) {
  const st = status();
  const products = [...S.products].sort(byName);
  if (!st.locked && !forceStart) {
    const today = ymd(now());
    let msg;
    if (st.state === 'sem-produtos') msg = 'Cadastre produtos para começar as conferências.';
    else if (st.state === 'primeiro-dia') msg = 'Os produtos são recém-cadastrados. A conferência obrigatória começa no próximo dia de conferência.';
    else if (st.state === 'nao-iniciada') msg = `A primeira conferência será em ${fmtDay(st.next)} (${weekday(st.next)}).`;
    else msg = `Conferência ${st.due === today ? 'de hoje' : `do dia ${fmtDay(st.due)}`} feita por <b>${esc(st.count.by)}</b> em ${fmtDateTime(st.count.at)}.`;
    main().innerHTML = `
      <h2>Conferência</h2>
      <div class="banner green">${msg}</div>
      <div class="card">
        <p>Próxima conferência: <b>${fmtDay(st.next)}</b> (${weekday(st.next)}).</p>
        <p class="small muted">Hoje ${isCountDay(today, S.schedule.startDate) ? 'é' : 'não é'} dia de conferência. As conferências são dia sim, dia não.</p>
      </div>
      ${products.length ? `<button class="block secondary" id="extra">Fazer uma contagem extra agora</button>` : ''}`;
    const ex = $('#extra');
    if (ex) ex.onclick = () => viewCount(true);
    return;
  }
  const draft = loadDraft();
  main().innerHTML = `
    ${st.locked && !isOwner() ? `<div class="banner lock">🔒 Hoje é dia de conferência. Conte todos os produtos para liberar o app.</div>` : ''}
    ${st.state === 'atrasada' ? `<div class="banner red">Conferência atrasada (dia ${fmtDay(st.due)}).</div>` : ''}
    <h2>Conferência de estoque</h2>
    <p class="muted small">Conte cada produto e digite a quantidade que existe de verdade na prateleira.</p>
    <div class="small"><span id="done-n">0</span> de ${products.length} contados</div>
    <div class="progress"><div id="bar" style="width:0%"></div></div>
    <ul class="list" id="clist">
      ${products.map(p => `
        <li class="count-item" data-id="${p.id}">
          ${p.photoKey ? `<img class="thumb" alt="" data-thumb="${p.id}">` : `<div class="thumb empty">📦</div>`}
          <div class="info">${esc(p.name)}</div>
          <input type="number" inputmode="numeric" min="0" step="1" placeholder="?" aria-label="Quantidade de ${esc(p.name)}" value="${esc(draft[p.id] ?? '')}">
        </li>`).join('')}
    </ul>
    <div id="cerr" class="banner red hidden"></div>
    <div class="sticky-bottom"><button class="block" id="finish" disabled>Concluir conferência</button></div>`;
  const update = () => {
    const d = {};
    let n = 0;
    $$('#clist li').forEach(li => {
      const v = $('input', li).value.trim();
      const ok = /^\d+$/.test(v);
      li.classList.toggle('done', ok);
      if (v !== '') d[li.dataset.id] = v;
      if (ok) n++;
    });
    saveDraft(d);
    $('#done-n').textContent = n;
    $('#bar').style.width = (products.length ? 100 * n / products.length : 0) + '%';
    $('#finish').disabled = n !== products.length;
  };
  $('#clist').oninput = update;
  update();
  $('#finish').onclick = async () => {
    const values = {};
    for (const li of $$('#clist li')) {
      const v = $('input', li).value.trim();
      if (!/^\d+$/.test(v)) { $('#cerr').textContent = 'Falta contar algum produto.'; $('#cerr').classList.remove('hidden'); return; }
      values[li.dataset.id] = Number(v);
    }
    $('#finish').disabled = true;
    const at = new Date().toISOString();
    const fresh = (await db.all('products')).filter(p => !p.deleted);
    const items = [];
    const updated = [];
    for (const p of fresh) {
      if (!(p.id in values)) continue; // produto criado durante a contagem
      items.push({ productId: p.id, name: p.name, before: p.quantity, counted: values[p.id] });
      updated.push({ ...p, quantity: values[p.id], updatedAt: at, updatedBy: S.profile.name, _dirty: true });
    }
    const count = { id: uuid(), date: ymd(now()), at: now().toISOString(), by: S.profile.name, role: S.profile.role, items, _dirty: true };
    await db.saveCount(updated, count);
    cloud.syncSoon();
    try { localStorage.removeItem(draftKey()); } catch { /* ignore */ }
    toast('Conferência concluída. App liberado.');
    go('#estoque');
  };
  await fillThumbs(main());
}

// ---------- tela: histórico (dono) ----------
async function viewHistory() {
  const st = status();
  const rows = S.schedule ? history({ now: now(), start: S.schedule.startDate, deadline: S.schedule.deadline, counts: S.counts, productDays: S.products.map(p => ymd(new Date(p.createdAt))) }) : [];
  const label = {
    'feita': ['Feita', 'ok'], 'feita-atrasada': ['Feita com atraso', 'late'], 'nao-feita': ['Não feita', 'bad'],
    'atrasada': ['ATRASADA', 'bad'], 'pendente': ['Pendente', 'late'], 'sem-cobranca': ['Sem cobrança (produtos novos)', ''],
  };
  const all = [...S.counts].sort((a, b) => b.at.localeCompare(a.at));
  const diffs = c => c.items.filter(i => i.counted !== i.before);
  main().innerHTML = `
    ${countBanner()}
    <h2>Conferências</h2>
    <div class="card small">Dias de conferência: dia sim, dia não, desde ${S.schedule ? fmtDay(S.schedule.startDate) : '-'}. Prazo diário: ${esc(S.schedule?.deadline || '18:00')}. Próxima: ${fmtDay(st.next)}.</div>
    <h3>Por dia de conferência</h3>
    ${rows.length ? `<table class="hist"><thead><tr><th>Dia</th><th>Situação</th><th>Quem / quando</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${fmtDay(r.day)}<br><span class="muted small">${weekday(r.day)}</span></td>
        <td class="st ${label[r.state][1]}">${label[r.state][0]}</td>
        <td>${r.count ? `${esc(r.count.by)}<br><span class="muted small">${fmtDateTime(r.count.at)}</span>` : '—'}</td></tr>`).join('')}
    </tbody></table>` : `<p class="muted">Ainda não houve dia de conferência.</p>`}
    <h3>Todas as contagens</h3>
    ${all.length ? all.map(c => `
      <div class="card">
        <b>${fmtDateTime(c.at)}</b> por ${esc(c.by)} <span class="muted small">(${c.role === 'dono' ? 'dono' : 'funcionário'})</span>
        <div class="small">${c.items.length} produtos contados, ${diffs(c).length} com diferença.</div>
        ${diffs(c).length ? `<details><summary>Ver diferenças</summary><table class="hist">
          <tr><th>Produto</th><th>Antes</th><th>Contado</th></tr>
          ${diffs(c).map(i => `<tr><td>${esc(i.name)}</td><td>${i.before}</td><td class="${i.counted > i.before ? 'diff-pos' : 'diff-neg'}">${i.counted}</td></tr>`).join('')}
        </table></details>` : ''}
      </div>`).join('') : `<p class="muted">Nenhuma contagem registrada.</p>`}`;
}

// ---------- tela: ajustes ----------
async function viewSettings() {
  const pending = await cloud.countPending();
  main().innerHTML = `
    <h2>Ajustes</h2>
    <div class="card">
      <div><b>${esc(S.profile.name)}</b> <span class="muted">(${isOwner() ? 'dono' : 'funcionário'})</span></div>
      <div class="small muted">${esc(S.profile.email || '')}</div>
      <p class="small" id="sync-info"></p>
      <button class="block secondary" id="sync-now">Sincronizar agora</button>
    </div>
    ${isOwner() ? `
    <div class="card">
      <h3 style="margin-top:0">Código da clínica</h3>
      <p class="small muted">O funcionário digita este código ao criar a conta no celular dele.</p>
      <div style="font-size:30px;font-weight:700;letter-spacing:4px;text-align:center" id="code">${esc(S.schedule?.code || '— (sincronize)')}</div>
      <p><button class="block secondary" id="newcode">Gerar código novo</button></p>
    </div>
    <div class="card">
      <form id="fs">
        <h3 style="margin-top:0">Conferência</h3>
        <label for="sd">Primeiro dia de conferência</label>
        <input id="sd" type="date" value="${esc(S.schedule?.startDate || ymd(now()))}">
        <p class="small muted">Depois disso a conferência é dia sim, dia não.</p>
        <label for="dl">Horário limite</label>
        <input id="dl" type="time" value="${esc(S.schedule?.deadline || '18:00')}">
        <p class="small muted">Passado esse horário sem conferência, ela aparece como atrasada.</p>
        <p><button class="block">Salvar conferência</button></p>
      </form>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Pessoas com acesso</h3>
      <div id="members" class="small muted">Carregando…</div>
    </div>` : ''}
    <div class="card">
      <button class="block secondary" id="logout">Sair desta conta</button>
    </div>
    <p class="small muted">Versão ${APP_VERSION}.</p>`;
  const info = () => {
    const st = cloud.state;
    const el = $('#sync-info');
    if (!el) return;
    el.textContent = syncText(st) + (st.lastOk ? ` Última sincronização: ${fmtDateTime(st.lastOk)}.` : '');
  };
  info();
  $('#sync-now').onclick = async () => { await cloud.requestSync(); info(); toast(syncText(cloud.state)); };
  $('#logout').onclick = async () => {
    const n = await cloud.countPending();
    if (n && !confirm(`Há ${n} alteração(ões) ainda não enviada(s). Se sair agora, elas serão perdidas. Sair mesmo assim?`)) return;
    if (!n && !confirm('Sair desta conta neste celular?')) return;
    await cloud.signOut();
    await db.clearData();
    go('#estoque');
  };
  if (!isOwner()) return;
  $('#newcode').onclick = async () => {
    if (!confirm('Gerar um código novo? O código atual deixa de funcionar para novos cadastros.')) return;
    try { $('#code').textContent = await cloud.newCode(); toast('Código novo gerado'); }
    catch (e) { toast(cloud.errorText(e)); }
  };
  $('#fs').onsubmit = async e => {
    e.preventDefault();
    if (!$('#sd').value || !$('#dl').value) return;
    await db.put('settings', { ...S.schedule, startDate: $('#sd').value, deadline: $('#dl').value }, 'schedule');
    await db.put('settings', true, 'scheduleDirty');
    cloud.syncSoon();
    toast('Conferência salva');
    render();
  };
  try {
    const list = await cloud.members();
    $('#members').innerHTML = list.map(m => `
      <div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)">
        <div><b style="color:var(--text)">${esc(m.nome)}</b> <span>(${m.papel === 'dono' ? 'dono' : 'funcionário'})</span></div>
        ${m.papel === 'dono' ? '' : `<button class="secondary" style="flex:none;min-height:36px;padding:6px 10px" data-rm="${m.user_id}" data-nome="${esc(m.nome)}">Tirar acesso</button>`}
      </div>`).join('');
    $$('#members [data-rm]').forEach(b => {
      b.onclick = async () => {
        if (!confirm(`Tirar o acesso de ${b.dataset.nome}? A pessoa não verá mais o estoque.`)) return;
        try { await cloud.removeMember(b.dataset.rm); toast('Acesso retirado'); render(); }
        catch (e) { toast(cloud.errorText(e)); }
      };
    });
  } catch (e) {
    $('#members').textContent = 'Não foi possível carregar (' + cloud.errorText(e) + ').';
  }
}

function syncText(st) {
  if (st.status === 'offline') return st.pending ? `Sem internet. ${st.pending} alteração(ões) esperando para enviar.` : 'Sem internet.';
  if (st.status === 'syncing') return 'Sincronizando…';
  if (st.status === 'error') return `Erro ao sincronizar: ${st.error}`;
  if (st.status === 'logged-out') return 'Sessão expirada: toque em "Sair desta conta" e entre de novo.';
  if (st.pending) return `${st.pending} alteração(ões) esperando para enviar.`;
  if (st.status === 'ok') return 'Tudo sincronizado.';
  return '';
}

function renderSyncBadge() {
  const el = $('#sync');
  if (!el) return;
  const st = cloud.state;
  let t = '';
  if (!S.profile) t = '';
  else if (st.status === 'offline') t = st.pending ? `📴 offline · ${st.pending} pendente(s)` : '📴 offline';
  else if (st.status === 'syncing') t = '⏳ sincronizando';
  else if (st.status === 'error') t = '⚠️ erro de sincronização';
  else if (st.status === 'logged-out') t = '⚠️ entre de novo (Ajustes)';
  else if (st.pending) t = `⏳ ${st.pending} pendente(s)`;
  else if (st.status === 'ok') t = '☁️ sincronizado';
  el.textContent = t;
}

// ---------- início ----------
window.addEventListener('hashchange', render);
// reavalia o bloqueio quando o app volta para a tela (ex.: virou o dia)
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
setInterval(() => { if (!document.hidden) renderChromeOnly(); }, 60_000);
function renderChromeOnly() {
  if (!S.profile) return;
  const r = route();
  if (locked() && r.name !== 'conferencia') render();
}

// quando chegam dados de outro celular, redesenha (sem atrapalhar quem está digitando)
cloud.onChange(async (st, changed) => {
  if (st.status === 'removed' && S.profile) {
    await cloud.signOut();
    await db.clearData();
    S.profile = null;
    renderChrome(route());
    return viewSetup('entrar', 'Seu acesso a esta clínica foi retirado pelo dono.');
  }
  renderSyncBadge();
  const info = $('#sync-info');
  if (info) info.textContent = syncText(st);
  if (!changed || !S.profile) return;
  const r = route();
  if (['novo', 'editar'].includes(r.name)) return;
  if (r.name === 'conferencia' && $('#clist')) {
    const wasLocked = locked();
    await load();
    if (wasLocked === locked()) return;
  }
  render();
});

if ('serviceWorker' in navigator && !window.__noSW) {
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW', err));
}

// pede ao navegador para não apagar os dados locais por falta de espaço
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

// usado pelos testes automáticos para esperar a tela terminar de desenhar
window.__app = { render, S, idle: () => rendering, cloud };
(async () => {
  if (await db.get('settings', 'profile')) cloud.startAuto();
  render();
})();
