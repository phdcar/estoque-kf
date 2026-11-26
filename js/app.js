import { db } from './db.js';
import { processPhoto } from './lineart.js';
import { ymd, countStatus, history, isCountDay } from './schedule.js';
import { level, isLow, missing, need, shoppingList, shoppingText, summary } from './stock.js';
import { illustrationFor, SKETCH_FILTER } from './illustrations.js';
import { I } from './icons.js';
import * as cloud from './cloud.js';

export const APP_VERSION = '0.3.0';
export { isLow };

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
const WEEK = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const weekday = s => { const [y, m, d] = s.split('-').map(Number); return WEEK[new Date(y, m - 1, d).getDay()]; };
const fmtTime = iso => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const fmtDateTime = iso => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const DEFAULT_CATEGORIES = ['Insumos', 'Alegra'];

function toast(msg) {
  for (const old of $$('.toast')) old.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
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

// miniatura: foto (desenho de traço) quando existe; senão, o desenho esquemático do produto
const thumbHtml = p => `<span class="thumb ill" data-thumb="${p.id}">${illustrationFor(p.name)}</span>`;
async function fillThumbs(root) {
  for (const el of $$('[data-thumb]', root)) {
    const p = S.products.find(x => x.id === el.dataset.thumb);
    const u = p && await photoUrls(p);
    if (!u) continue;
    const img = document.createElement('img');
    img.className = 'thumb';
    img.alt = '';
    img.src = u.line;
    el.replaceWith(img);
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
const roleName = r => (r === 'dono' ? 'Dono' : 'Funcionário');
const categories = () => [...new Set([...DEFAULT_CATEGORIES, ...S.products.map(p => (p.category || '').trim()).filter(Boolean)])]
  .sort((a, b) => a.localeCompare(b, 'pt-BR'));
const suppliers = () => [...new Set(S.products.map(p => (p.supplier || '').trim()).filter(Boolean))]
  .sort((a, b) => a.localeCompare(b, 'pt-BR'));

// ---------- navegação ----------
const main = () => $('#main');

function route() {
  const h = location.hash.replace(/^#\/?/, '') || 'painel';
  const [name, arg] = h.split('/');
  return { name, arg };
}

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function renderChrome(r) {
  $('#who').innerHTML = S.profile
    ? `${esc(S.profile.name)} · <span class="role">${roleName(S.profile.role)}</span><br><span id="sync"></span>` : '';
  renderSyncBadge();
  const tabs = $('#tabs');
  if (!S.profile) { tabs.classList.add('hidden'); return; }
  tabs.classList.remove('hidden');
  const lk = locked();
  const alerts = S.products.filter(isLow).length;
  const items = [
    ['painel', I.radar, 'Painel', alerts],
    ['estoque', I.box, 'Estoque'],
    ['conferencia', status().locked ? I.alert : I.check, 'Conferência'],
    ...(isOwner() ? [['historico', I.calendar, 'Histórico']] : []),
    ['ajustes', I.gear, 'Ajustes'],
  ];
  const active = k => r.name === k || (k === 'estoque' && ['produto', 'novo', 'editar'].includes(r.name));
  tabs.innerHTML = items.map(([k, ico, label, badge]) =>
    `<a href="#${k}" class="${active(k) ? 'on' : ''} ${lk && k !== 'conferencia' ? 'disabled' : ''}" data-tab="${k}"
      ${active(k) ? 'aria-current="page"' : ''}>${ico}${label}${badge ? `<span class="dot">${badge}</span>` : ''}</a>`).join('');
}

let rendering = Promise.resolve();
function render() {
  rendering = rendering.then(doRender).catch(err => {
    console.error(err);
    main().innerHTML = `<div class="banner red">${I.alert}<span>Erro: ${esc(err.message)}</span></div>`;
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
    case 'estoque': return viewList(r.arg);
    case 'conferencia': return viewCount();
    case 'historico': return isOwner() ? viewHistory() : viewDashboard();
    case 'ajustes': return viewSettings();
    default: return viewDashboard();
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
    if (old.length && confirm(`Este celular tem ${plural(old.length, 'produto cadastrado', 'produtos cadastrados')} antes da sincronização.\n\nOK: enviar para a nuvem.\nCancelar: apagar deste celular.`)) {
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
  go('#painel');
}

function viewSetup(mode = 'entrar', info = '') {
  const mark = `<div class="mark"><div class="logo"></div><h2>Clínica KF</h2><p>Gestão de estoque</p></div>`;
  if (!cloud.configured()) {
    main().innerHTML = `<div class="auth">${mark}<div class="banner red">${I.alert}<span>O app ainda não está ligado ao servidor (falta a chave do Supabase).</span></div></div>`;
    return;
  }
  const tabs = `<div class="toggle" role="tablist">
      <button type="button" class="${mode === 'entrar' ? 'on' : ''}" data-m="entrar">Entrar</button>
      <button type="button" class="${mode === 'criar' ? 'on' : ''}" data-m="criar">Criar conta</button>
    </div>`;
  let body;
  if (mode === 'entrar') {
    body = `
      ${tabs}
      ${info ? `<div class="banner green">${I.info}<span>${esc(info)}</span></div>` : ''}
      <form id="f" autocomplete="on" class="card">
        <label for="em" style="margin-top:0">E-mail</label>
        <input id="em" type="email" autocomplete="username" inputmode="email" required>
        <label for="pw">Senha</label>
        <input id="pw" type="password" autocomplete="current-password" required>
        <div id="err" class="banner red hidden" style="margin:14px 0 0"></div>
        <p style="margin-top:16px"><button class="block" type="submit" id="go">Entrar</button></p>
      </form>`;
  } else if (mode === 'criar') {
    body = `
      ${tabs}
      <form id="f" autocomplete="on" class="card">
        <label for="nm" style="margin-top:0">Seu nome</label>
        <input id="nm" type="text" maxlength="60" required placeholder="Ex.: Ana" autocomplete="name">
        <label for="em">E-mail</label>
        <input id="em" type="email" autocomplete="username" inputmode="email" required>
        <label for="pw">Senha</label>
        <input id="pw" type="password" autocomplete="new-password" minlength="6" required>
        <div class="hint">Mínimo de 6 caracteres.</div>
        <label for="cd">Código da clínica</label>
        <input id="cd" type="text" maxlength="12" autocapitalize="characters" placeholder="Peça ao dono">
        <div class="hint">Funcionário: use o código que aparece em Ajustes, no celular do dono.
        Dono: deixe em branco ao criar a primeira conta da clínica.</div>
        <div id="err" class="banner red hidden" style="margin:14px 0 0"></div>
        <p style="margin-top:16px"><button class="block" type="submit" id="go">Criar conta</button></p>
      </form>`;
  } else { // logado, mas ainda não faz parte da clínica
    body = `
      <h2 style="text-align:center">Entrar na clínica</h2>
      <form id="f" class="card">
        <label for="nm" style="margin-top:0">Seu nome</label>
        <input id="nm" type="text" maxlength="60" required>
        <label for="cd">Código da clínica</label>
        <input id="cd" type="text" maxlength="12" autocapitalize="characters" placeholder="Peça ao dono">
        <div id="err" class="banner red ${info ? '' : 'hidden'}" style="margin:14px 0 0">${esc(info)}</div>
        <p style="margin-top:16px"><button class="block" type="submit" id="go">Continuar</button></p>
        <p><button class="block secondary" type="button" id="out">Sair desta conta</button></p>
      </form>`;
  }
  main().innerHTML = `<div class="auth">${mode === 'entrar-clinica' ? '' : mark}${body}</div>`;
  if (mode === 'entrar-clinica') $('#out').onclick = async () => { await cloud.signOut(); viewSetup(); };
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

// ---------- peças comuns ----------
function countBanner() {
  const st = status();
  if (st.state === 'atrasada') {
    return `<a href="#conferencia" class="banner red">${I.alert}<span><b>Conferência atrasada</b> (dia ${fmtDay(st.due)}). ${isOwner() ? 'O funcionário ainda não contou o estoque.' : 'Faça a contagem agora.'}</span></a>`;
  }
  if (st.state === 'pendente') {
    return `<a href="#conferencia" class="banner amber">${I.check}<span>Hoje é dia de conferência. Prazo até ${esc(S.schedule?.deadline || '18:00')}.</span></a>`;
  }
  if (st.state === 'feita' && isOwner() && st.due === st.today) {
    return `<div class="banner green">${I.ok}<span>Conferência de hoje feita por ${esc(st.count.by)} às ${fmtTime(st.count.at)}.</span></div>`;
  }
  return '';
}

const LEVEL = {
  esgotado: ['Esgotado', 'red'], critico: ['Abaixo do mínimo', 'red'], atencao: ['No limite', 'amber'],
  ok: ['Em dia', 'green'], 'sem-minimo': ['Sem mínimo', 'gray'], 'esgotado-sem-minimo': ['Sem mínimo', 'gray'],
};

function prodRow(p) {
  const l = level(p);
  const [label, tone] = LEVEL[l];
  const low = isLow(p);
  const miss = missing(p);
  const pct = Number(p.min) >= 1 ? Math.min(100, Math.round(100 * p.quantity / (p.min * 2))) : 0;
  const meta = [p.supplier ? esc(p.supplier) : '', p.category ? esc(p.category) : ''].filter(Boolean).join(' · ');
  return `
    <li class="prod ${low ? 'low' : ''} ${l === 'atencao' ? 'warn' : ''}" data-id="${p.id}" data-level="${l}">
      ${low ? '<span class="ping" aria-hidden="true"></span>' : ''}
      <a href="#produto/${p.id}" aria-label="${esc(p.name)}">${thumbHtml(p)}</a>
      <div class="info">
        <a class="name" href="#produto/${p.id}">${esc(p.name)}</a>
        <div class="meta">${meta}${miss.length ? `${meta ? ' · ' : ''}<span class="miss">Falta: ${miss.join(', ')}</span>` : ''}</div>
        <div class="level"><span class="pill ${tone}">${label}</span>
          ${Number(p.min) >= 1 ? `<span class="bar ${tone}" title="${p.quantity} de ${p.min}"><i style="width:${pct}%"></i></span>` : ''}</div>
      </div>
      <div class="qty">
        <button class="secondary" data-act="dec" aria-label="Diminuir ${esc(p.name)}">−</button>
        <span><span class="n">${p.quantity}</span><span class="of">mín. ${Number(p.min) >= 1 ? p.min : '—'}</span></span>
        <button class="secondary" data-act="inc" aria-label="Aumentar ${esc(p.name)}">+</button>
      </div>
    </li>`;
}

function bindQty(list) {
  list.onclick = async e => {
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
    if (delta < 0 && isLow(p) && p.quantity + 1 >= p.min) toast(`${p.name} ficou abaixo do mínimo`);
    render();
  };
}

// radar desenhado: cada ponto é um produto em alerta ou no limite
function radarSvg(products) {
  const hash = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const blips = products.filter(p => ['esgotado', 'critico', 'atencao'].includes(level(p))).map(p => {
    const a = (hash(p.id) % 360) * Math.PI / 180;
    const r = 30 + 38 * Math.min(1, p.quantity / (p.min * 1.5 || 1));
    const red = isLow(p);
    return `<circle class="blip" style="animation-delay:${((hash(p.id) % 360) / 360 * 4).toFixed(2)}s" cx="${(75 + r * Math.cos(a)).toFixed(1)}" cy="${(75 + r * Math.sin(a)).toFixed(1)}" r="${red ? 4 : 3}" fill="${red ? '#F2A49C' : '#EBCB8B'}"/>`;
  }).join('');
  return `<svg viewBox="0 0 150 150" aria-hidden="true">
    <defs><linearGradient id="sw" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#CDB27E" stop-opacity="0"/><stop offset="1" stop-color="#CDB27E" stop-opacity=".45"/></linearGradient></defs>
    <circle cx="75" cy="75" r="72" fill="#0E1520" stroke="rgba(205,178,126,.45)"/>
    ${[54, 36, 18].map(r => `<circle cx="75" cy="75" r="${r}" fill="none" stroke="rgba(243,239,231,.10)"/>`).join('')}
    <path d="M75 3v144M3 75h144" stroke="rgba(243,239,231,.07)"/>
    <g class="sweep"><path d="M75 75L75 3A72 72 0 0 1 133.2 32.6z" fill="url(#sw)"/><path d="M75 75L133.2 32.6" stroke="#CDB27E" stroke-width="1.2"/></g>
    ${blips}
  </svg>`;
}

// ---------- tela: painel (radar) ----------
async function viewDashboard() {
  const sm = summary(S.products);
  const alerts = S.products.filter(isLow).sort((a, b) => (a.quantity - a.min) - (b.quantity - b.min) || byName(a, b));
  const atn = S.products.filter(p => level(p) === 'atencao').sort(byName);
  const inc = S.products.filter(p => missing(p).length).sort(byName);
  const list = shoppingList(S.products);
  const h = now().getHours();
  const hello = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const today = now().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const todayCap = today.charAt(0).toUpperCase() + today.slice(1);
  main().innerHTML = `
    <div class="hello"><div class="eyebrow">Painel</div><h2>${hello}, ${esc(S.profile.name.split(' ')[0])}</h2><div class="d">${todayCap}</div></div>
    ${countBanner()}
    <section class="radar-card" aria-label="Radar de estoque">
      <div class="radar ${sm.alerta ? 'alert' : ''}">${radarSvg(S.products)}
        <div class="ctr"><b id="radar-n">${sm.alerta}</b><span>em alerta</span></div></div>
      <div class="kpis">
        <a class="kpi red" href="#estoque/alerta"><span><i style="background:#F2A49C"></i>Abaixo do mínimo</span><b>${sm.alerta}</b></a>
        <a class="kpi red" href="#estoque/alerta"><span><i style="background:#E0796F"></i>Esgotados (zerados)</span><b>${sm.esgotado}</b></a>
        <a class="kpi amber" href="#estoque/atencao"><span><i style="background:#EBCB8B"></i>No limite</span><b>${sm.atencao}</b></a>
        <a class="kpi green" href="#estoque/ok"><span><i style="background:#9ED2B5"></i>Em dia</span><b>${sm.ok}</b></a>
        <a class="kpi gray" href="#estoque/incompleto"><span><i style="background:#9A9284"></i>Cadastro incompleto</span><b>${sm.incompleto}</b></a>
      </div>
    </section>

    <h3>Radar · abaixo do mínimo (${alerts.length})</h3>
    ${alerts.length ? `<ul class="list" id="alist">${alerts.map(prodRow).join('')}</ul>`
      : `<div class="card empty">${I.ok}<p>Nenhum produto abaixo do mínimo.</p></div>`}

    ${list.length ? `
    <h3>Reposição por fornecedor</h3>
    <div class="card" id="shop">
      ${list.map(g => `
        <div class="supplier">
          <div class="hd"><b>${esc(g.supplier)}</b><span class="small muted">${plural(g.items.length, 'item', 'itens')}</span></div>
          ${g.items.map(i => `<a class="it" href="#produto/${i.id}"><span>${esc(i.name)}<small>tem ${i.quantity} · mínimo ${i.min}</small></span><span class="q">comprar ${i.need}</span></a>`).join('')}
        </div>`).join('')}
      <button class="block gold" id="share">${I.share}Enviar lista de reposição</button>
    </div>` : ''}

    ${atn.length ? `<h3>No limite (${atn.length})</h3><ul class="list" id="wlist">${atn.map(prodRow).join('')}</ul>` : ''}

    ${inc.length ? `
    <h3>Cadastro incompleto (${inc.length})</h3>
    <div class="card small">
      <p style="margin-top:0" class="muted">Sem o estoque mínimo o radar não consegue vigiar o produto. Complete os dados destes itens:</p>
      ${inc.slice(0, 8).map(p => `<a class="it" style="display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--line);text-decoration:none" href="#editar/${p.id}">
        <span>${esc(p.name)}<br><span class="muted">Falta: ${missing(p).join(', ')}</span></span><span style="color:var(--gold-ink);font-weight:500">Completar</span></a>`).join('')}
      ${inc.length > 8 ? `<a class="btn secondary block" style="margin-top:8px" href="#estoque/incompleto">Ver todos (${inc.length})</a>` : ''}
    </div>` : ''}
    <p class="foot">Clínica KF · Estoque ${APP_VERSION}</p>`;
  for (const l of [$('#alist'), $('#wlist')]) if (l) bindQty(l);
  const sh = $('#share');
  if (sh) sh.onclick = async () => {
    const text = shoppingText(list, now());
    try {
      if (navigator.share) { await navigator.share({ title: 'Reposição de estoque · Clínica KF', text }); return; }
      await navigator.clipboard.writeText(text);
      toast('Lista copiada. Cole no WhatsApp ou no e-mail.');
    } catch (e) {
      if (e?.name !== 'AbortError') toast('Não foi possível compartilhar a lista.');
    }
  };
  await fillThumbs(main());
}

// ---------- tela: lista de produtos ----------
let searchTerm = '';
let category = '';
const FILTERS = [['todos', 'Todos'], ['alerta', 'Abaixo do mínimo'], ['atencao', 'No limite'], ['ok', 'Em dia'], ['incompleto', 'Incompletos']];
const matchFilter = (p, f) => f === 'alerta' ? isLow(p) : f === 'atencao' ? level(p) === 'atencao'
  : f === 'ok' ? level(p) === 'ok' : f === 'incompleto' ? missing(p).length > 0 : true;

async function viewList(filter = 'todos') {
  if (!FILTERS.some(([k]) => k === filter)) filter = 'todos';
  const low = S.products.filter(isLow);
  const cats = categories().filter(c => S.products.some(p => p.category === c));
  if (category && !cats.includes(category)) category = '';
  const base = S.products.filter(p => !category || p.category === category);
  const items = base.filter(p => matchFilter(p, filter)).sort((a, b) => (isLow(b) - isLow(a)) || byName(a, b));
  const count = f => base.filter(p => matchFilter(p, f)).length;
  main().innerHTML = `
    ${countBanner()}
    ${low.length ? `<div class="banner red" id="low-banner">${I.alert}<span>${low.length} ${low.length === 1 ? 'produto abaixo' : 'produtos abaixo'} do mínimo: ${low.map(p => esc(p.name)).join(', ')}</span></div>` : ''}
    <div class="eyebrow">Estoque</div>
    <h2>Produtos <span class="muted" style="font-family:var(--sans);font-size:16px">(${S.products.length})</span></h2>
    ${S.products.length > 5 ? `<div class="search">${I.search}<input type="search" id="q" placeholder="Buscar por nome ou fornecedor" value="${esc(searchTerm)}" aria-label="Buscar"></div>` : ''}
    ${S.products.length ? `<div class="chips" id="filters">${FILTERS.map(([k, t]) =>
      `<button type="button" class="chip ${k === filter ? 'on' : ''} ${k === 'alerta' ? 'red' : ''}" data-f="${k}">${t}<span class="c">${count(k)}</span></button>`).join('')}</div>` : ''}
    ${cats.length > 1 ? `<div class="chips" id="cats"><button type="button" class="chip ${!category ? 'on' : ''}" data-c="">Todas as categorias</button>${cats.map(c =>
      `<button type="button" class="chip ${c === category ? 'on' : ''}" data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}
    ${S.products.length === 0 ? `<div class="card empty">${I.box}<p>Nenhum produto cadastrado ainda.</p><p>Toque em <b>Produto</b> para cadastrar o primeiro.</p></div>` : ''}
    ${S.products.length && !items.length ? `<div class="card empty">${I.ok}<p>Nenhum produto neste filtro.</p></div>` : ''}
    <ul class="list" id="plist">${items.map(prodRow).join('')}</ul>
    <a href="#novo" class="btn fab" id="add">${I.plus}Produto</a>`;
  const applySearch = () => {
    const t = searchTerm.trim().toLowerCase();
    $$('#plist li').forEach(li => {
      const p = S.products.find(x => x.id === li.dataset.id);
      li.classList.toggle('hidden', !!t && !(`${p.name} ${p.supplier || ''}`).toLowerCase().includes(t));
    });
  };
  const q = $('#q');
  if (q) { q.oninput = () => { searchTerm = q.value; applySearch(); }; applySearch(); }
  $$('#filters .chip').forEach(b => { b.onclick = () => go(b.dataset.f === 'todos' ? '#estoque' : '#estoque/' + b.dataset.f); });
  $$('#cats .chip').forEach(b => { b.onclick = () => { category = b.dataset.c; render(); }; });
  bindQty($('#plist'));
  await fillThumbs(main());
}

// ---------- tela: detalhe do produto ----------
async function viewProduct(id) {
  const p = S.products.find(x => x.id === id);
  if (!p) return go('#estoque');
  const u = await photoUrls(p);
  const l = level(p);
  const [label, tone] = LEVEL[l];
  const miss = missing(p);
  main().innerHTML = `
    <a class="back" href="#estoque">${I.back}Estoque</a>
    <div class="eyebrow">${esc(p.category || 'Sem categoria')}</div>
    <h2>${esc(p.name)}</h2>
    <div style="margin:6px 0"><span class="pill ${tone}">${label}</span></div>
    ${isLow(p) ? `<div class="banner red">${I.alert}<span>Abaixo do mínimo: tem ${p.quantity}, mínimo ${p.min}. Comprar pelo menos ${need(p)}.</span></div>` : ''}
    ${miss.length ? `<div class="banner amber">${I.info}<span>Cadastro incompleto. Falta: ${miss.join(', ')}.</span></div>` : ''}
    <div class="hero">${u ? `<img class="big-img" id="big" src="${u.line}" alt="Desenho do produto">` : illustrationFor(p.name)}</div>
    ${u ? `
      <div class="toggle">
        <button class="on" data-v="line">Desenho</button>
        <button data-v="orig">Foto original</button>
      </div>` : `<p class="small muted" style="text-align:center;margin:0">Desenho ilustrativo. Edite o produto para colocar uma foto.</p>`}
    <div class="facts">
      <div><span>Quantidade</span><b class="${isLow(p) ? 'red' : ''}" id="f-qt">${p.quantity}</b></div>
      <div><span>Estoque mínimo</span><b ${Number(p.min) >= 1 ? '' : 'class="miss"'}>${Number(p.min) >= 1 ? p.min : 'Não definido'}</b></div>
      <div><span>Fornecedor</span><b class="${p.supplier ? 'sm' : 'miss'}">${p.supplier ? esc(p.supplier) : 'Não informado'}</b></div>
      <div><span>Categoria</span><b class="${p.category ? 'sm' : 'miss'}">${p.category ? esc(p.category) : 'Não informada'}</b></div>
    </div>
    <p class="small muted">Atualizado em ${fmtDateTime(p.updatedAt)}${p.updatedBy ? ' por ' + esc(p.updatedBy) : ''}.</p>
    <p><a class="btn block" href="#editar/${p.id}">${I.edit}Editar produto</a></p>
    <p><button class="block danger" id="del">${I.trash}Excluir produto</button></p>`;
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
  const req = '<span class="req" aria-hidden="true">*</span>';
  main().innerHTML = `
    <a class="back" href="${p ? '#produto/' + p.id : '#estoque'}">${I.back}Voltar</a>
    <div class="eyebrow">${p ? 'Editar' : 'Novo'}</div>
    <h2>${p ? 'Editar produto' : 'Novo produto'}</h2>
    <p class="lead small">Todos os campos com ${req} são obrigatórios.</p>
    <form id="f" autocomplete="off" novalidate class="card">
      <label for="nm" style="margin-top:0">Nome do produto ${req}</label>
      <input id="nm" type="text" maxlength="80" value="${esc(p?.name || '')}" placeholder="Ex.: Luva de procedimento M">
      <label for="ct">Categoria ${req}</label>
      <input id="ct" type="text" maxlength="40" list="ct-list" value="${esc(p?.category || '')}" placeholder="Ex.: Insumos">
      <datalist id="ct-list">${categories().map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      <label for="fn">Fornecedor ${req}</label>
      <input id="fn" type="text" maxlength="60" list="fn-list" value="${esc(p?.supplier || '')}" placeholder="Ex.: Cremer">
      <datalist id="fn-list">${suppliers().map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      <div class="hint">Onde a clínica compra este produto.</div>
      <div class="row">
        <div><label for="qt">Quantidade atual ${req}</label>
          <input id="qt" type="number" inputmode="numeric" min="0" step="1" value="${p ? p.quantity : ''}"></div>
        <div><label for="mn">Estoque mínimo ${req}</label>
          <input id="mn" type="number" inputmode="numeric" min="1" step="1" value="${p && Number(p.min) >= 1 ? p.min : ''}"></div>
      </div>
      <div class="hint">Abaixo do mínimo, o produto fica vermelho e entra no radar.</div>
      <label>Foto</label>
      <div class="row">
        <button type="button" class="secondary" id="cam">${I.camera}Tirar foto</button>
        <button type="button" class="secondary" id="gal">${I.image}Da galeria</button>
      </div>
      <div class="hint">Opcional. Sem foto, o app mostra um desenho ilustrativo do produto.</div>
      <input type="file" id="f-cam" accept="image/*" capture="environment" class="hidden">
      <input type="file" id="f-gal" accept="image/*" class="hidden">
      <div class="photos ${existing ? '' : 'hidden'}" id="pv">
        <figure><img id="pv-line" src="${existing?.line || ''}" alt=""><figcaption>Desenho de traço</figcaption></figure>
        <figure><img id="pv-orig" src="${existing?.orig || ''}" alt=""><figcaption>Foto original</figcaption></figure>
      </div>
      <div id="err" class="banner red hidden" role="alert" style="margin:14px 0 0"></div>
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
  const showErr = (m, field) => {
    const el = $('#err'); el.textContent = m; el.classList.remove('hidden');
    $$('#f input').forEach(i => i.classList.toggle('invalid', i.id === field));
    if (field) $('#' + field).focus();
  };
  $('#f').onsubmit = async e => {
    e.preventDefault();
    const name = $('#nm').value.trim().replace(/\s+/g, ' ');
    const cat = $('#ct').value.trim().replace(/\s+/g, ' ');
    const sup = $('#fn').value.trim().replace(/\s+/g, ' ');
    const qt = $('#qt').value.trim(), mn = $('#mn').value.trim();
    if (!name) return showErr('Informe o nome do produto.', 'nm');
    const dup = S.products.find(x => x.id !== p?.id && x.name.trim().toLowerCase() === name.toLowerCase());
    if (dup) return showErr(`Já existe um produto chamado "${dup.name}".`, 'nm');
    if (!cat) return showErr('Informe a categoria (ex.: Insumos).', 'ct');
    if (!sup) return showErr('Informe o fornecedor.', 'fn');
    if (!/^\d+$/.test(qt)) return showErr('Informe a quantidade atual (número inteiro, 0 ou mais).', 'qt');
    if (!/^\d+$/.test(mn) || Number(mn) < 1) return showErr('Informe o estoque mínimo (número inteiro, 1 ou mais).', 'mn');
    $('#save').disabled = true;
    const ts = new Date().toISOString();
    const rec = p ? { ...(await db.get('products', p.id)) } : { id: uuid(), createdAt: ts, createdBy: S.profile.name };
    Object.assign(rec, { name, category: cat, supplier: sup, quantity: Number(qt), min: Number(mn), updatedAt: ts, updatedBy: S.profile.name });
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
      <div class="eyebrow">Conferência</div>
      <h2>Contagem do estoque</h2>
      <div class="banner green">${I.ok}<span>${msg}</span></div>
      <div class="card">
        <p style="margin-top:0">Próxima conferência: <b>${fmtDay(st.next)}</b> (${weekday(st.next)}).</p>
        <p class="small muted" style="margin-bottom:0">Hoje ${isCountDay(today, S.schedule?.startDate || today) ? 'é' : 'não é'} dia de conferência. As conferências são feitas em dias alternados.</p>
      </div>
      ${products.length ? `<button class="block secondary" id="extra">Fazer uma contagem extra agora</button>` : ''}`;
    const ex = $('#extra');
    if (ex) ex.onclick = () => viewCount(true);
    return;
  }
  const draft = loadDraft();
  main().innerHTML = `
    ${st.locked && !isOwner() ? `<div class="banner lock">${I.lock}<span><b>Hoje é dia de conferência.</b> Conte todos os produtos para liberar o app.</span></div>` : ''}
    ${st.state === 'atrasada' ? `<div class="banner red">${I.alert}<span>Conferência atrasada (dia ${fmtDay(st.due)}).</span></div>` : ''}
    <div class="eyebrow">Conferência</div>
    <h2>Contagem do estoque</h2>
    <p class="muted small">Conte cada produto e digite a quantidade que existe de verdade na prateleira.</p>
    <div class="small"><b id="done-n">0</b> de ${products.length} contados</div>
    <div class="progress"><div id="bar" style="width:0%"></div></div>
    <ul class="list" id="clist">
      ${products.map(p => `
        <li class="count-item" data-id="${p.id}">
          ${thumbHtml(p)}
          <div class="info">${esc(p.name)}${p.supplier ? `<small>${esc(p.supplier)}</small>` : ''}</div>
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
    const lowNow = updated.filter(isLow).length;
    toast(`Conferência concluída. App liberado.${lowNow ? ` ${plural(lowNow, 'produto ficou', 'produtos ficaram')} abaixo do mínimo.` : ''}`);
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
    'atrasada': ['Atrasada', 'bad'], 'pendente': ['Pendente', 'late'], 'sem-cobranca': ['Sem cobrança (produtos novos)', ''],
  };
  const all = [...S.counts].sort((a, b) => b.at.localeCompare(a.at));
  const diffs = c => c.items.filter(i => i.counted !== i.before);
  main().innerHTML = `
    ${countBanner()}
    <div class="eyebrow">Histórico</div>
    <h2>Conferências</h2>
    <div class="card small">Conferências em dias alternados desde ${S.schedule ? fmtDay(S.schedule.startDate) : '—'}. Prazo diário: ${esc(S.schedule?.deadline || '18:00')}. Próxima: <b>${fmtDay(st.next)}</b>.</div>
    <h3>Por dia de conferência</h3>
    ${rows.length ? `<div class="card" style="padding:4px 12px"><table class="hist"><thead><tr><th>Dia</th><th>Situação</th><th>Quem e quando</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${fmtDay(r.day)}<br><span class="muted small">${weekday(r.day)}</span></td>
        <td class="st ${label[r.state][1]}">${label[r.state][0]}</td>
        <td>${r.count ? `${esc(r.count.by)}<br><span class="muted small">${fmtDateTime(r.count.at)}</span>` : '—'}</td></tr>`).join('')}
    </tbody></table></div>` : `<p class="muted">Ainda não houve dia de conferência.</p>`}
    <h3>Todas as contagens</h3>
    ${all.length ? all.map(c => `
      <div class="card">
        <b>${fmtDateTime(c.at)}</b> · ${esc(c.by)} <span class="muted small">(${c.role === 'dono' ? 'dono' : 'funcionário'})</span>
        <div class="small">${plural(c.items.length, 'produto contado', 'produtos contados')}, ${plural(diffs(c).length, 'com diferença', 'com diferença')}.</div>
        ${diffs(c).length ? `<details><summary>Ver diferenças</summary><table class="hist">
          <tr><th>Produto</th><th>Antes</th><th>Contado</th></tr>
          ${diffs(c).map(i => `<tr><td>${esc(i.name)}</td><td>${i.before}</td><td class="${i.counted > i.before ? 'diff-pos' : 'diff-neg'}">${i.counted}</td></tr>`).join('')}
        </table></details>` : ''}
      </div>`).join('') : `<p class="muted">Nenhuma contagem registrada.</p>`}`;
}

// ---------- tela: ajustes ----------
async function viewSettings() {
  main().innerHTML = `
    <div class="eyebrow">Ajustes</div>
    <h2>Conta e clínica</h2>
    <div class="card">
      <div><b>${esc(S.profile.name)}</b> <span class="muted">(${isOwner() ? 'dono' : 'funcionário'})</span></div>
      <div class="small muted">${esc(S.profile.email || '')}</div>
      <p class="small" id="sync-info"></p>
      <button class="block secondary" id="sync-now">${I.sync}Sincronizar agora</button>
    </div>
    ${isOwner() ? `
    <h3>Código da clínica</h3>
    <div class="card">
      <p class="small muted" style="margin-top:0">O funcionário digita este código ao criar a conta no celular dele.</p>
      <div class="code" id="code">${esc(S.schedule?.code || '— (sincronize)')}</div>
      <p style="margin-bottom:0"><button class="block secondary" id="newcode">Gerar código novo</button></p>
    </div>
    <h3>Conferência</h3>
    <div class="card">
      <form id="fs">
        <label for="sd" style="margin-top:0">Primeiro dia de conferência</label>
        <input id="sd" type="date" value="${esc(S.schedule?.startDate || ymd(now()))}">
        <div class="hint">Depois disso, a conferência é feita em dias alternados.</div>
        <label for="dl">Horário limite</label>
        <input id="dl" type="time" value="${esc(S.schedule?.deadline || '18:00')}">
        <div class="hint">Passado esse horário sem conferência, ela aparece como atrasada.</div>
        <p style="margin-bottom:0"><button class="block">Salvar conferência</button></p>
      </form>
    </div>
    <h3>Pessoas com acesso</h3>
    <div class="card"><div id="members" class="small muted">Carregando…</div></div>` : ''}
    <h3>Instalar no celular</h3>
    <div class="card small">
      <p style="margin-top:0"><b>iPhone (Safari):</b> toque em Compartilhar e depois em “Adicionar à Tela de Início”.</p>
      <p style="margin-bottom:0"><b>Android (Chrome):</b> toque no menu ⋮ e depois em “Instalar app” ou “Adicionar à tela inicial”.</p>
    </div>
    <div class="card"><button class="block danger" id="logout">Sair desta conta</button></div>
    <p class="foot">Clínica KF · Estoque ${APP_VERSION}</p>`;
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
    if (n && !confirm(`${n === 1 ? 'Há 1 alteração ainda não enviada' : `Há ${n} alterações ainda não enviadas`}. Se sair agora, ${n === 1 ? 'ela será perdida' : 'elas serão perdidas'}. Sair mesmo assim?`)) return;
    if (!n && !confirm('Sair desta conta neste celular?')) return;
    await cloud.signOut();
    await db.clearData();
    go('#painel');
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
      <div class="row" style="padding:8px 0;border-bottom:1px solid var(--line)">
        <div><b style="color:var(--text);font-weight:500">${esc(m.nome)}</b> <span>(${m.papel === 'dono' ? 'dono' : 'funcionário'})</span></div>
        ${m.papel === 'dono' ? '' : `<button class="secondary" style="flex:none;min-height:36px;padding:6px 12px" data-rm="${m.user_id}" data-nome="${esc(m.nome)}">Tirar acesso</button>`}
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
  const pend = n => (n === 1 ? '1 alteração esperando para enviar.' : `${n} alterações esperando para enviar.`);
  if (st.status === 'offline') return st.pending ? `Sem internet. ${pend(st.pending)}` : 'Sem internet.';
  if (st.status === 'syncing') return 'Sincronizando…';
  if (st.status === 'error') return `Erro ao sincronizar: ${st.error}`;
  if (st.status === 'logged-out') return 'Sessão expirada: toque em "Sair desta conta" e entre de novo.';
  if (st.pending) return pend(st.pending);
  if (st.status === 'ok') return 'Tudo sincronizado.';
  return '';
}

function renderSyncBadge() {
  const el = $('#sync');
  if (!el) return;
  const st = cloud.state;
  let t = '', c = '';
  if (!S.profile) t = '';
  else if (st.status === 'offline') { t = st.pending ? `offline · ${st.pending} pendente${st.pending === 1 ? '' : 's'}` : 'offline'; c = 'bad'; }
  else if (st.status === 'syncing') { t = 'sincronizando'; c = 'wait'; }
  else if (st.status === 'error') { t = 'erro de sincronização'; c = 'bad'; }
  else if (st.status === 'logged-out') { t = 'entre de novo (Ajustes)'; c = 'bad'; }
  else if (st.pending) { t = `${st.pending} pendente${st.pending === 1 ? '' : 's'}`; c = 'wait'; }
  else if (st.status === 'ok') { t = 'sincronizado'; c = 'ok'; }
  el.className = c;
  el.innerHTML = t ? `<i></i>${t}` : '';
}

// ---------- início ----------
$('#defs').innerHTML = SKETCH_FILTER;
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
