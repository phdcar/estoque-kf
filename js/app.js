import { db } from './db.js';
import { processPhoto } from './lineart.js';
import { ymd, countStatus, history, isWeekday } from './schedule.js';
import { level, isLow, missing, need, shoppingList, shoppingText, summary, health, buy, sentenceCase, expiryLevel, expiryText, daysToExpiry, EXPIRY_SOON, NO_EXPIRY } from './stock.js';
import { illustrationFor, SKETCH_FILTER } from './illustrations.js';
import { I } from './icons.js';
import * as cloud from './cloud.js';
import { startAmbient, skyState, PERIOD_NAME, tapURI } from './ambient.js';

export const APP_VERSION = '0.6.0';
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
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
const weekday = s => { const [y, m, d] = s.split('-').map(Number); return WEEK[new Date(y, m - 1, d).getDay()]; };
const fmtTime = iso => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const fmtDateTime = iso => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const DEFAULT_CATEGORIES = ['Insumos', 'Medicamentos'];

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
  updateBadge();
}

// número no ícone do app (iPhone com iOS 16.4+ e app instalado na tela de início; Android/Chrome)
// = produtos abaixo do alerta + vencidos. Com o app fechado, só atualiza quando houver notificação push (etapa 3).
const b64uBytes = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushCanAsk = () => typeof Notification !== 'undefined' && Notification.permission !== 'granted' && ('setAppBadge' in navigator || 'PushManager' in window);
function pushStatusText() {
  const ios = /iPhone|iPad/.test(navigator.userAgent);
  if (ios && !standalone()) return 'No iPhone, primeiro instale o app na tela de início (veja abaixo) e abra por lá. Precisa do iOS 16.4 ou mais novo.';
  if (typeof Notification === 'undefined' || !('PushManager' in window || 'setAppBadge' in navigator)) return 'Este celular ou navegador não aceita notificações do app.';
  if (Notification.permission === 'granted') return 'Ativado neste celular.';
  if (Notification.permission === 'denied') return 'As notificações estão bloqueadas. Libere nos ajustes do celular.';
  return 'Ainda não ativado neste celular.';
}
const badgeCount = () => S.products.filter(p => isLow(p) || expiryLevel(p, now()) === 'vencido').length;
function updateBadge() {
  try {
    if (!('setAppBadge' in navigator) || !S.profile) return;
    const n = badgeCount();
    (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
  } catch { /* sem suporte */ }
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
  if (!S.profile) { tabs.classList.add('hidden'); document.body.classList.remove('has-tabs'); return; }
  tabs.classList.remove('hidden'); document.body.classList.add('has-tabs');
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
let lastRoute = '';
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
  const key = r.name + '/' + (r.arg || '');
  const changed = key !== lastRoute; lastRoute = key;
  main().classList.toggle('enter', false);
  if (changed) { void main().offsetWidth; main().classList.add('enter'); window.scrollTo(0, 0); }
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
  const daysTxt = ds => ds.map(d => `${weekday(d)}, ${fmtDay(d)}`).join('; ');
  if (st.missing?.length) {
    return isOwner()
      ? `<a href="#historico" class="banner red">${I.alert}<span><b>Conferência não feita</b> e ainda sem justificativa: ${daysTxt(st.missing)}.</span></a>`
      : `<a href="#conferencia" class="banner red">${I.alert}<span><b>Falta justificar</b> por que não houve conferência: ${daysTxt(st.missing)}.</span></a>`;
  }
  if (st.state === 'atrasada') {
    return `<a href="#conferencia" class="banner red">${I.alert}<span><b>Conferência atrasada.</b> ${isOwner() ? 'O prazo de hoje passou e o funcionário ainda não contou o estoque.' : 'O prazo de hoje passou. Faça a contagem agora.'}</span></a>`;
  }
  if (st.state === 'pendente') {
    return `<a href="#conferencia" class="banner amber">${I.check}<span>Conferência de hoje ainda não feita. Prazo até ${esc(S.schedule?.deadline || '18:00')}.</span></a>`;
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

const EXP_TONE = { vencido: 'red', 'vence-logo': 'amber', ok: 'gray' };
function expPill(p) {
  const e = expiryLevel(p, now());
  if (e !== 'vencido' && e !== 'vence-logo') return '';
  return `<span class="pill exp ${EXP_TONE[e]}" title="Validade ${fmtDay(p.expiry)}">${I.clock || ''}${expiryText(p, now())}</span>`;
}

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
        <div class="level"><span class="pill ${tone}">${label}</span>${expPill(p)}
          ${Number(p.min) >= 1 ? `<span class="bar ${tone}" title="${p.quantity} de ${p.min}"><i style="width:${pct}%"></i></span>` : ''}</div>
      </div>
      <div class="qty">
        <button class="secondary" data-act="dec" aria-label="Diminuir ${esc(p.name)}">−</button>
        <span class="qv"><span class="n">${p.quantity}</span><span class="of">mín. ${Number(p.min) >= 1 ? p.min : '—'}</span></span>
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
const partWord = v => v == null ? 'Sem dados' : v >= 0.85 ? 'Ótimo' : v >= 0.7 ? 'Bom' : v >= 0.5 ? 'Atenção' : 'Crítico';
const RING_C = 2 * Math.PI * 84;
function ringSvg(score) {
  const ticks = Array.from({ length: 60 }, (_, i) => {
    const a = (i / 60) * 2 * Math.PI, r1 = 98, r2 = i % 5 ? 95 : 92;
    return `<line x1="${(100 + r1 * Math.sin(a)).toFixed(1)}" y1="${(100 - r1 * Math.cos(a)).toFixed(1)}" x2="${(100 + r2 * Math.sin(a)).toFixed(1)}" y2="${(100 - r2 * Math.cos(a)).toFixed(1)}"/>`;
  }).join('');
  const low = score != null && score < 50;
  return `<svg viewBox="0 0 200 200" aria-hidden="true">
    <defs><linearGradient id="rg" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="${low ? '#B8574E' : '#9A7A44'}"/><stop offset=".55" stop-color="${low ? '#E0796F' : '#CDB27E'}"/><stop offset="1" stop-color="${low ? '#F6C1BA' : '#F3E6C4'}"/></linearGradient></defs>
    <g class="ticks">${ticks}</g>
    <circle class="track" cx="100" cy="100" r="84"/>
    <circle class="prog" cx="100" cy="100" r="84" stroke="url(#rg)" stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${RING_C.toFixed(2)}" data-to="${(RING_C * (1 - (score || 0) / 100)).toFixed(2)}"/>
  </svg>`;
}

// conferência dos últimos 10 dias úteis (feita = 1, justificada = meio, não feita = 0); hoje não entra
function countRate() {
  const rows = history({ now: now(), start: S.schedule?.startDate || ymd(now()), deadline: S.schedule?.deadline || '18:00', counts: S.counts,
    productDays: S.products.map(p => ymd(new Date(p.createdAt))), limit: 11 })
    .filter(r => r.day !== ymd(now()) && r.state !== 'sem-cobranca').slice(0, 10);
  if (!rows.length) return { rate: null, done: 0, total: 0 };
  const done = rows.filter(r => r.state === 'feita').length, just = rows.filter(r => r.state === 'justificada').length;
  return { rate: (done + just * 0.5) / rows.length, done, total: rows.length };
}

function insight(sm, alerts, exp) {
  const first = alerts[0];
  if (sm.esgotado) return `${plural(sm.esgotado, 'produto esgotado', 'produtos esgotados')}. Comece a reposição por <b>${esc(first.name)}</b>.`;
  if (alerts.length) return `${plural(alerts.length, 'produto está', 'produtos estão')} abaixo do alerta. O mais urgente é <b>${esc(first.name)}</b>.`;
  if (sm.vencido) return `${plural(sm.vencido, 'produto vencido', 'produtos vencidos')} na prateleira. Retire e reponha.`;
  if (exp.length) return `<b>${esc(exp[0].name)}</b> vence em breve. Use esse lote primeiro.`;
  if (sm.incompleto) return `Estoque em dia. Complete o cadastro de ${plural(sm.incompleto, 'produto', 'produtos')} para a nota ficar exata.`;
  return 'Tudo em dia. Estoque, validade e conferência sob controle.';
}

// anima o anel, os números e as barras quando a tela abre
function animateDashboard(enter) {
  const ease = t => 1 - Math.pow(1 - t, 3);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const prog = $('.ring .prog');
  const nums = $$('[data-count]');
  const bars = $$('.contrib .b i');
  if (!enter || reduce) {
    if (prog) { prog.style.transition = 'none'; prog.setAttribute('stroke-dashoffset', prog.dataset.to); }
    nums.forEach(n => { n.textContent = n.dataset.count; });
    bars.forEach(b => { b.style.transition = 'none'; b.style.width = b.dataset.w; });
    return;
  }
  nums.forEach(n => { n.textContent = '0'; });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (prog) prog.setAttribute('stroke-dashoffset', prog.dataset.to);
    bars.forEach((b, i) => { b.style.transitionDelay = `${0.35 + i * 0.08}s`; b.style.width = b.dataset.w; });
    const t0 = performance.now(), dur = 1300;
    const tick = t => {
      const k = ease(Math.min(1, (t - t0) / dur));
      nums.forEach(n => { n.textContent = Math.round(Number(n.dataset.count) * k); });
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
}

// ---------- tela: painel (radar) ----------
async function viewDashboard() {
  const sm = summary(S.products, now());
  const exp = S.products.filter(p => ['vencido', 'vence-logo'].includes(expiryLevel(p, now()))).sort((a, b) => daysToExpiry(a, now()) - daysToExpiry(b, now()) || byName(a, b));
  const alerts = S.products.filter(isLow).sort((a, b) => (a.quantity - a.min) - (b.quantity - b.min) || byName(a, b));
  const atn = S.products.filter(p => level(p) === 'atencao').sort(byName);
  const inc = S.products.filter(p => missing(p).length).sort(byName);
  const list = shoppingList(S.products);
  const cr = countRate();
  const hl = health(S.products, now(), cr.rate);
  const h = now().getHours();
  const hello = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const today = now().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const todayCap = today.charAt(0).toUpperCase() + today.slice(1);
  main().innerHTML = `
    <div class="hello">
      <div class="eyebrow">${PERIOD_NAME[skyState(now()).name]} · ${fmtTime(now().toISOString())}</div>
      <h2>${hello}, ${esc(S.profile.name.split(' ')[0])}</h2>
      <div class="d">${todayCap}</div>
      <div class="orn" aria-hidden="true"><i></i><b></b><i></i></div>
    </div>
    ${countBanner()}
    <section class="score-card" aria-label="Saúde do estoque">
      <div class="face-tap" aria-hidden="true"><div class="shB"><div class="shP"></div></div></div>
      <div class="ring ${hl.score != null && hl.score < 50 ? 'low' : ''}">${ringSvg(hl.score)}
        <div class="ctr"><span class="lbl">Saúde do estoque</span><b ${hl.score != null ? `data-count="${hl.score}"` : ''}>${hl.score ?? '–'}</b><span class="word">${hl.word}</span></div></div>
      <p class="insight">${insight(sm, alerts, exp)}</p>
      <div class="contrib">
        ${[
          ['Estoque acima do alerta', hl.parts.estoque, `${sm.total - sm.alerta - sm.semMinimo} de ${sm.total - sm.semMinimo}`],
          ['Validade em dia', hl.parts.validade, hl.parts.validade == null ? 'informe as validades' : `${sm.vencido} ${sm.vencido === 1 ? 'vencido' : 'vencidos'} · ${sm.venceLogo} a vencer`],
          ['Conferência diária', hl.parts.conferencia, cr.total ? `${cr.done} de ${cr.total} dias úteis` : 'ainda sem dias'],
          ['Cadastro completo', hl.parts.cadastro, `${sm.total - sm.incompleto} de ${sm.total}`],
        ].map(([t, v, d]) => `<div class="c ${v == null ? 'na' : v < 0.5 ? 'bad' : v < 0.7 ? 'mid' : ''}"><div class="t"><span>${t}</span><em>${partWord(v)}</em></div>
          <div class="b"><i data-w="${v == null ? 0 : Math.max(2, Math.round(v * 100))}%"></i></div><small>${d}</small></div>`).join('')}
      </div>
    </section>
    <div class="tiles">
      <a class="tile red" href="#estoque/alerta"><b id="radar-n" data-count="${sm.alerta}">${sm.alerta}</b><span>Abaixo do mínimo</span></a>
      <a class="tile red" href="#estoque/alerta"><b data-count="${sm.esgotado}">${sm.esgotado}</b><span>Esgotados</span></a>
      <a class="tile amber" href="#estoque/atencao"><b data-count="${sm.atencao}">${sm.atencao}</b><span>No limite</span></a>
      <a class="tile green" href="#estoque/ok"><b data-count="${sm.ok}">${sm.ok}</b><span>Em dia</span></a>
      <a class="tile ${sm.vencido ? 'red' : 'gray'}" href="#estoque/validade"><b data-count="${sm.vencido}">${sm.vencido}</b><span>Vencidos</span></a>
      <a class="tile amber" href="#estoque/validade"><b data-count="${sm.venceLogo}">${sm.venceLogo}</b><span>Vencem em ${EXPIRY_SOON} dias</span></a>
    </div>

    <h3>Radar · abaixo do mínimo (${alerts.length})</h3>
    ${alerts.length ? `<ul class="list" id="alist">${alerts.map(prodRow).join('')}</ul>`
      : `<div class="card empty">${I.ok}<p>Nenhum produto abaixo do mínimo.</p></div>`}

    ${exp.length ? `<h3>Validade · vencidos e a vencer (${exp.length})</h3><ul class="list" id="elist">${exp.map(prodRow).join('')}</ul>` : ''}

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
      ${inc.slice(0, 8).map(p => `<a class="it" style="display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--line);color:inherit;text-decoration:none" href="#editar/${p.id}">
        <span>${esc(p.name)}<br><span class="muted">Falta: ${missing(p).join(', ')}</span></span><span style="color:var(--gold-ink);font-weight:500">Completar</span></a>`).join('')}
      ${inc.length > 8 ? `<a class="btn secondary block" style="margin-top:8px" href="#estoque/incompleto">Ver todos (${inc.length})</a>` : ''}
    </div>` : ''}
    <p class="foot">Clínica KF · Estoque ${APP_VERSION}</p>`;
  for (const l of [$('#alist'), $('#wlist'), $('#elist')]) if (l) bindQty(l);
  animateDashboard(main().classList.contains('enter'));
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
const FILTERS = [['todos', 'Todos'], ['alerta', 'Abaixo do mínimo'], ['atencao', 'No limite'], ['ok', 'Em dia'], ['validade', 'Validade'], ['incompleto', 'Incompletos']];
const matchFilter = (p, f) => f === 'alerta' ? isLow(p) : f === 'atencao' ? level(p) === 'atencao'
  : f === 'ok' ? level(p) === 'ok' : f === 'validade' ? ['vencido', 'vence-logo'].includes(expiryLevel(p, now())) : f === 'incompleto' ? missing(p).length > 0 : true;

async function viewList(filter = 'todos') {
  if (!FILTERS.some(([k]) => k === filter)) filter = 'todos';
  const low = S.products.filter(isLow);
  const cats = categories().filter(c => S.products.some(p => p.category === c));
  if (category && !cats.includes(category)) category = '';
  const base = S.products.filter(p => !category || p.category === category);
  const items = base.filter(p => matchFilter(p, filter)).sort(filter === 'validade' ? (a, b) => daysToExpiry(a, now()) - daysToExpiry(b, now()) : (a, b) => (isLow(b) - isLow(a)) || byName(a, b));
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
    ${(() => { const e = expiryLevel(p, now()); return e === 'vencido' ? `<div class="banner red">${I.alert}<span>${expiryText(p, now())} (validade ${fmtDay(p.expiry)}). Separe para descarte.</span></div>`
      : e === 'vence-logo' ? `<div class="banner amber">${I.info}<span>${expiryText(p, now())} (validade ${fmtDay(p.expiry)}). Use este lote primeiro.</span></div>` : ''; })()}
    ${miss.length ? `<div class="banner amber">${I.info}<span>Cadastro incompleto. Falta: ${miss.join(', ')}.</span></div>` : ''}
    <div class="hero">${u ? `<img class="big-img" id="big" src="${u.line}" alt="Desenho do produto">` : illustrationFor(p.name)}</div>
    ${u ? `
      <div class="toggle">
        <button class="on" data-v="line">Desenho</button>
        <button data-v="orig">Foto original</button>
      </div>` : `<p class="small muted" style="text-align:center;margin:0">Desenho ilustrativo. Edite o produto para colocar uma foto.</p>`}
    <div class="facts">
      <div><span>Quantidade</span><b class="${isLow(p) ? 'red' : ''}" id="f-qt">${p.quantity}</b></div>
      <div><span>Alerta (mínimo)</span><b ${Number(p.min) >= 1 ? '' : 'class="miss"'}>${Number(p.min) >= 1 ? p.min : 'Não definido'}</b></div>
      <div><span>Estoque ideal</span><b class="${Number(p.ideal) >= 1 ? '' : 'sm muted'}">${Number(p.ideal) >= 1 ? p.ideal : '—'}</b></div>
      <div><span>Comprar</span><b class="${isLow(p) ? 'red' : 'sm muted'}">${isLow(p) ? buy(p) : buy(p) ? `${buy(p)} <small>até o ideal</small>` : 'Nada agora'}</b></div>
      <div><span>Fornecedor</span><b class="${p.supplier ? 'sm' : 'miss'}">${p.supplier ? esc(p.supplier) : 'Não informado'}</b></div>
      <div><span>Categoria</span><b class="${p.category ? 'sm' : 'miss'}">${p.category ? esc(p.category) : 'Não informada'}</b></div>
      <div class="wide"><span>Validade</span><b id="f-vl" class="sm ${!p.expiry ? 'miss' : ''} ${{ vencido: 'red', 'vence-logo': 'amber' }[expiryLevel(p, now())] || ''}">${p.expiry === NO_EXPIRY ? 'ND · sem validade' : p.expiry ? `${fmtDay(p.expiry)} <small>· ${expiryText(p, now())}</small>` : 'Não informada'}</b></div>
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
        <div><label for="mn">Alerta (mínimo) ${req}</label>
          <input id="mn" type="number" inputmode="numeric" min="1" step="1" value="${p && Number(p.min) >= 1 ? p.min : ''}"></div>
      </div>
      <div class="hint">Abaixo do alerta, o produto fica vermelho, entra no radar e você recebe o e-mail.</div>
      <label for="id">Estoque ideal</label>
      <input id="id" type="number" inputmode="numeric" min="1" step="1" value="${p && Number(p.ideal) >= 1 ? p.ideal : ''}">
      <div class="hint">Opcional. A lista de compras sugere comprar até o ideal.</div>
      <label for="vl">Data de validade ${req}</label>
      <div class="row vrow">
        <input id="vl" type="date" value="${p?.expiry && p.expiry !== NO_EXPIRY ? esc(p.expiry) : ''}" ${p?.expiry === NO_EXPIRY ? 'disabled' : ''}>
        <label class="nd"><input type="checkbox" id="nd" ${p?.expiry === NO_EXPIRY ? 'checked' : ''}><span>ND</span><small>sem validade</small></label>
      </div>
      <div class="hint">Do lote que está na prateleira (o que vence primeiro). Vencidos ficam vermelhos; a ${EXPIRY_SOON} dias do vencimento o produto entra no radar.</div>
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
  $('#nd').onchange = () => { $('#vl').disabled = $('#nd').checked; if ($('#nd').checked) $('#vl').value = ''; $('#vl').dispatchEvent(new Event('input')); };
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
    const name = sentenceCase($('#nm').value.trim().replace(/\s+/g, ' '));
    const cat = $('#ct').value.trim().replace(/\s+/g, ' ');
    const sup = $('#fn').value.trim().replace(/\s+/g, ' ');
    const qt = $('#qt').value.trim(), mn = $('#mn').value.trim();
    const idl = $('#id').value.trim();
    const nd = $('#nd').checked, vl = nd ? NO_EXPIRY : $('#vl').value.trim();
    if (!name) return showErr('Informe o nome do produto.', 'nm');
    const dup = S.products.find(x => x.id !== p?.id && x.name.trim().toLowerCase() === name.toLowerCase());
    if (dup) return showErr(`Já existe um produto chamado "${dup.name}".`, 'nm');
    if (!cat) return showErr('Informe a categoria (ex.: Insumos).', 'ct');
    if (!sup) return showErr('Informe o fornecedor.', 'fn');
    if (!/^\d+$/.test(qt)) return showErr('Informe a quantidade atual (número inteiro, 0 ou mais).', 'qt');
    if (!/^\d+$/.test(mn) || Number(mn) < 1) return showErr('Informe o estoque mínimo (número inteiro, 1 ou mais).', 'mn');
    if (idl && !/^\d+$/.test(idl)) return showErr('Estoque ideal: use um número inteiro.', 'id');
    if (!vl) return showErr('Informe a data de validade ou marque ND (sem validade).', 'vl');
    if (vl !== NO_EXPIRY && !/^\d{4}-\d{2}-\d{2}$/.test(vl)) return showErr('Data de validade inválida.', 'vl');
    $('#save').disabled = true;
    const ts = new Date().toISOString();
    const rec = p ? { ...(await db.get('products', p.id)) } : { id: uuid(), createdAt: ts, createdBy: S.profile.name };
    Object.assign(rec, { name, category: cat, supplier: sup, quantity: Number(qt), min: Number(mn), ideal: idl ? Number(idl) : null, expiry: vl, updatedAt: ts, updatedBy: S.profile.name });
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

async function viewJustify(st) {
  main().innerHTML = `
    <div class="banner lock">${I.lock}<span><b>Conferência não feita.</b> A contagem é diária, de segunda a sexta. Explique o motivo para liberar o app.</span></div>
    <div class="eyebrow">Conferência</div>
    <h2>Justificativa</h2>
    <div class="card">
      <p style="margin-top:0">${st.missing.length === 1 ? 'Dia sem conferência:' : 'Dias sem conferência:'}</p>
      <ul id="jdays" style="margin:0 0 6px;padding-left:18px">${st.missing.map(d => `<li>${cap(weekday(d))}, ${fmtDay(d)}</li>`).join('')}</ul>
      <label for="jt">Por que a conferência não foi feita? <span class="req" aria-hidden="true">*</span></label>
      <textarea id="jt" rows="4" maxlength="500" placeholder="Ex.: faltei por motivo de saúde."></textarea>
      <div class="hint">O dono recebe a justificativa por e-mail e ela fica no histórico.</div>
      <div id="jerr" class="banner red hidden" style="margin:12px 0 0"></div>
      <p style="margin-bottom:0"><button class="block" id="jsend">Enviar justificativa</button></p>
    </div>`;
  $('#jsend').onclick = async () => {
    const text = $('#jt').value.trim().replace(/\s+/g, ' ');
    if (text.length < 10) { $('#jerr').textContent = 'Escreva o motivo com pelo menos 10 letras.'; $('#jerr').classList.remove('hidden'); $('#jt').focus(); return; }
    $('#jsend').disabled = true;
    const rec = { id: uuid(), date: ymd(now()), at: now().toISOString(), by: S.profile.name, role: S.profile.role, items: [], justification: text, days: st.missing, _dirty: true };
    await db.put('counts', rec);
    cloud.syncSoon();
    toast('Justificativa enviada ao dono.');
    render();
  };
}

async function viewCount(forceStart) {
  const st = status();
  const products = [...S.products].sort(byName);
  if (st.missing?.length && !isOwner() && !forceStart) return viewJustify(st);
  if (!st.locked && !forceStart) {
    const today = ymd(now());
    let msg;
    if (st.state === 'sem-produtos') msg = 'Cadastre produtos para começar as conferências.';
    else if (st.state === 'primeiro-dia') msg = 'Os produtos foram cadastrados hoje. A conferência obrigatória começa no próximo dia útil.';
    else if (st.state === 'nao-iniciada') msg = `A primeira conferência será em ${fmtDay(st.next)} (${weekday(st.next)}).`;
    else if (st.state === 'fim-de-semana') msg = 'Hoje é fim de semana: não há conferência obrigatória.';
    else if (st.missing?.length) msg = `Conferência de hoje feita. Ainda falta a justificativa de ${plural(st.missing.length, 'dia', 'dias')} sem conferência.`;
    else msg = `Conferência de hoje feita por <b>${esc(st.count.by)}</b> em ${fmtDateTime(st.count.at)}.`;
    main().innerHTML = `
      <div class="eyebrow">Conferência</div>
      <h2>Contagem do estoque</h2>
      <div class="banner green">${I.ok}<span>${msg}</span></div>
      <div class="card">
        <p style="margin-top:0">Próxima conferência: <b>${fmtDay(st.next)}</b> (${weekday(st.next)}).</p>
        <p class="small muted" style="margin-bottom:0">A conferência é diária, de segunda a sexta-feira. Dia útil sem conferência precisa de justificativa.${isWeekday(today) ? '' : ' Hoje não é dia útil.'}</p>
      </div>
      ${products.length ? `<button class="block secondary" id="extra">Fazer uma contagem extra agora</button>` : ''}`;
    const ex = $('#extra');
    if (ex) ex.onclick = () => viewCount(true);
    return;
  }
  const draft = loadDraft();
  main().innerHTML = `
    ${st.locked && !isOwner() ? `<div class="banner lock">${I.lock}<span><b>Conferência diária.</b> Conte todos os produtos para liberar o app.</span></div>` : ''}
    ${st.state === 'atrasada' ? `<div class="banner red">${I.alert}<span>Conferência atrasada: o prazo de hoje (${esc(S.schedule?.deadline || '18:00')}) já passou.</span></div>` : ''}
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
    'feita': ['Feita', 'ok'], 'justificada': ['Justificada', 'late'], 'nao-feita': ['Não feita', 'bad'], 'primeiro-dia': ['Sem cobrança (produtos novos)', ''],
    'atrasada': ['Atrasada', 'bad'], 'pendente': ['Pendente', 'late'], 'sem-cobranca': ['Sem cobrança (produtos novos)', ''],
  };
  const all = S.counts.filter(c => !c.justification).sort((a, b) => b.at.localeCompare(a.at));
  const justs = S.counts.filter(c => c.justification).sort((a, b) => b.at.localeCompare(a.at));
  const diffs = c => c.items.filter(i => i.counted !== i.before);
  main().innerHTML = `
    ${countBanner()}
    <div class="eyebrow">Histórico</div>
    <h2>Conferências</h2>
    <div class="card small">Conferência diária, de segunda a sexta-feira, desde ${S.schedule ? fmtDay(S.schedule.startDate) : '—'}. Prazo: ${esc(S.schedule?.deadline || '18:00')}. Dia útil sem conferência precisa de justificativa.</div>
    <h3>Por dia útil</h3>
    ${rows.length ? `<div class="card" style="padding:4px 12px"><table class="hist"><thead><tr><th>Dia</th><th>Situação</th><th>Quem e quando</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${fmtDay(r.day)}<br><span class="muted small">${cap(weekday(r.day))}</span></td>
        <td class="st ${label[r.state][1]}">${label[r.state][0]}</td>
        <td>${r.count ? `${esc(r.count.by)}<br><span class="muted small">${fmtDateTime(r.count.at)}</span>`
          : r.justification ? `${esc(r.justification.by)}: “${esc(r.justification.justification)}”<br><span class="muted small">${fmtDateTime(r.justification.at)}</span>` : '—'}</td></tr>`).join('')}
    </tbody></table></div>` : `<p class="muted">Ainda não houve dia de conferência.</p>`}
    ${justs.length ? `<h3>Justificativas</h3>${justs.map(c => `
      <div class="card"><b>${esc(c.by)}</b> <span class="muted small">· ${fmtDateTime(c.at)}</span>
        <div class="small muted">${(c.days || [c.date]).map(d => `${cap(weekday(d))}, ${fmtDay(d)}`).join('; ')}</div>
        <p style="margin-bottom:0">“${esc(c.justification)}”</p></div>`).join('')}` : ''}
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
        <div class="hint">A partir desse dia, a conferência é diária, de segunda a sexta-feira.</div>
        <label for="dl">Horário limite</label>
        <input id="dl" type="time" value="${esc(S.schedule?.deadline || '18:00')}">
        <div class="hint">Passado esse horário sem conferência, ela aparece como atrasada. Dia útil que terminar sem conferência precisa de justificativa do funcionário.</div>
        <p style="margin-bottom:0"><button class="block">Salvar conferência</button></p>
      </form>
    </div>
    <h3>Pessoas com acesso</h3>
    <div class="card"><div id="members" class="small muted">Carregando…</div></div>` : ''}
    <h3>Notificações e número no ícone</h3>
    <div class="card small">
      <p style="margin-top:0">${isOwner() ? 'Receba no celular um aviso a cada mudança no estoque, e veja no ícone do app quantos produtos estão abaixo do alerta ou vencidos, mesmo com o app fechado.' : 'Mostra no ícone do app quantos produtos estão abaixo do alerta ou vencidos.'}</p>
      <p id="push-st" class="muted">${pushStatusText()}</p>
      ${pushCanAsk() ? `<p style="margin-bottom:0"><button class="block secondary" id="push-on">${isOwner() ? 'Ativar notificações' : 'Ativar número no ícone'}</button></p>` : ''}
    </div>
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
  const po = $('#push-on');
  if (po) po.onclick = async () => {
    const st = $('#push-st');
    po.disabled = true;
    try {
      const r = await Notification.requestPermission();
      if (r !== 'granted') { st.textContent = 'Permissão negada. Para ativar depois, libere as notificações do app nos ajustes do celular.'; po.disabled = false; return; }
      updateBadge();
      if (isOwner() && 'PushManager' in window) {
        st.textContent = 'Ativando…';
        const reg = await navigator.serviceWorker.ready;
        const key = await cloud.pushKey();
        const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBytes(key) });
        await cloud.pushSave(sub);
        await cloud.pushTest(sub.endpoint, badgeCount());
        st.textContent = 'Ativado neste celular. Enviei uma notificação de teste.';
      } else st.textContent = 'Número no ícone ativado neste celular.';
      po.remove();
    } catch (e) {
      st.textContent = 'Não foi possível ativar: ' + (e?.message || e);
      po.disabled = false;
    }
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

// Campos de data: o iPhone mostra a data no idioma da região do aparelho (ex.: "Nov 26, 2026").
// Por cima do campo nativo mostramos sempre DD/MM/AAAA em português; o toque continua abrindo o seletor do iOS.
const fmtBR = v => /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.split('-').reverse().join('/') : '';
function enhanceDates(root = document) {
  for (const el of root.querySelectorAll('input[type=date]:not([data-br])')) {
    el.dataset.br = '1';
    const w = document.createElement('span'); w.className = 'dwrap';
    const t = document.createElement('span'); t.className = 'dtext'; t.setAttribute('aria-hidden', 'true');
    el.replaceWith(w); w.append(el, t);
    const up = () => { const f = fmtBR(el.value); t.textContent = f || 'dd/mm/aaaa'; t.classList.toggle('empty', !f); w.classList.toggle('off', el.disabled); };
    el.addEventListener('input', up); el.addEventListener('change', up); up();
  }
}
new MutationObserver(() => enhanceDates()).observe(document.body, { childList: true, subtree: true });

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
$('#ver').textContent = 'versão ' + APP_VERSION;
document.documentElement.style.setProperty('--tap-deep', tapURI(15, 'deep'));
document.documentElement.style.setProperty('--tap-deephi', tapURI(15, 'deephi'));
try { startAmbient(); } catch (e) { console.warn('fundo', e); }
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
