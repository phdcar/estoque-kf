import { db } from './db.js';
import { processPhoto, shelfJpeg } from './lineart.js';
import { ymd, countStatus, history, isCountWeekday, sinceLastCount } from './schedule.js';
import { level, isLow, missing, need, shoppingList, shoppingText, itemNote, FORECAST_HORIZON, ORDER_COVER, summary, buy, sentenceCase, searchProducts, fold, expiryLevel, expiryText, daysToExpiry, EXPIRY_SOON, NO_EXPIRY } from './stock.js';
import { illustrationFor, SKETCH_FILTER } from './illustrations.js';
import { I } from './icons.js';
import * as cloud from './cloud.js';
import { startAmbient, skyState, PERIOD_NAME, tapURI } from './ambient.js';
import { consumption, forecastDays, suggestLevels, rateText, forecastText, withQuantity, addLot, lotsTotal, sortedLots,
  expiriesByMonth, stockValue, monthSummary, monthKey, brl, orderText, whatsappUrl, priceHistory, priceTrend, priceBySupplier, pctText, countPlan } from './insights.js';
import { scanBarcode } from './scanner.js';
import { lookupBarcode, isRetailCode } from './barcode-lookup.js';
import { installSwipe } from './swipe.js';

export const APP_VERSION = '0.9.2';
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
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const monthName = m => { const [y, mo] = m.split('-').map(Number); return `${MONTHS[mo - 1]} de ${y}`; };
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
  moves: [],              // movimentos (entrada, saída, ajuste, conferência, perda)
  orders: [],             // pedidos de compra
  cons: new Map(),        // id -> consumo calculado
  thumbs: new Map(),      // id -> { line, orig, key } (URLs de objeto)
};

async function load() {
  S.profile = await db.get('settings', 'profile') || null;
  S.schedule = await db.get('settings', 'schedule') || null;
  S.products = (await db.all('products')).filter(p => !p.deleted);
  S.counts = await db.all('counts');
  S.moves = (await db.all('moves')).sort((a, b) => a.at.localeCompare(b.at));
  S.orders = (await db.all('orders')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  S.cons = new Map(S.products.map(p => [p.id, consumption(S.moves, p.id, now())]));
  updateBadge();
  ensurePush();
}

// ---------- movimentos de estoque ----------
// Toda mudança de quantidade gera um movimento (para consumo, previsão, custo e relatório).
function makeMove(p, after, type, extra = {}) {
  return {
    id: uuid(), productId: p.id, name: p.name, type, delta: after - Number(p.quantity), before: Number(p.quantity), after,
    price: extra.price ?? (p.price ?? null), supplier: extra.supplier ?? (p.supplier || ''), orderId: extra.orderId || null,
    note: extra.note || '', by: S.profile.name, at: now().toISOString(), _dirty: true,
  };
}
const touch = p => ({ ...p, updatedAt: new Date().toISOString(), updatedBy: S.profile.name, _dirty: true });
// muda a quantidade de um produto, ajusta os lotes e grava o movimento junto
async function setQty(id, after, type, extra = {}) {
  const p = await db.get('products', id);
  if (!p || after < 0 || after === Number(p.quantity)) return p;
  const m = makeMove(p, after, type, extra);
  const next = touch(withQuantity(p, after));
  await db.saveMoves([next], [m]);
  cloud.syncSoon();
  return next;
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
// inscreve este celular no push (dono e funcionários) e guarda no banco
async function pushSubscribe() {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBytes(await cloud.pushKey()) });
  await cloud.pushSave(sub);
  return sub;
}
// permissão já dada (ex.: funcionário que só tinha o número no ícone): inscreve sem perguntar, uma vez por abertura
let pushChecked = false;
function ensurePush() {
  if (pushChecked || !S.profile || !navigator.onLine) return;
  pushChecked = true;
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || !('PushManager' in window) || !('serviceWorker' in navigator)) return;
    pushSubscribe().catch(() => { pushChecked = false; });
  } catch { /* sem suporte */ }
}
// liga as notificações neste celular (usado no cartão do painel e em Ajustes); escreve o andamento em el
async function activatePush(el) {
  const say = t => { if (el) el.textContent = t; };
  const r = await Notification.requestPermission();
  if (r !== 'granted') { say('Permissão negada. Para ativar depois, libere as notificações do app nos ajustes do celular.'); return false; }
  updateBadge();
  if ('PushManager' in window) {
    say('Ativando…');
    const sub = await pushSubscribe();
    await cloud.pushTest(sub.endpoint, badgeCount());
    say('Ativado neste celular. Enviei uma notificação de teste.');
  } else say('Número no ícone ativado neste celular.');
  return true;
}
// versão 0.9: cartão no painel para ninguém esquecer de ligar os avisos (some depois de ligar; "Agora não" esconde por 7 dias)
const PUSH_LATER = 'kf-avisos-depois';
function pushCard() {
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') return '';
  try { if (Number(localStorage.getItem(PUSH_LATER) || 0) > Date.now()) return ''; } catch { /* ignore */ }
  const ios = /iPhone|iPad/.test(navigator.userAgent);
  const what = isOwner() ? 'o resumo e o aviso de conferência atrasada na segunda-feira' : 'o lembrete da conferência de segunda-feira';
  let body, btn = '';
  if (ios && !standalone()) body = `No iPhone, os avisos só funcionam com o app na Tela de Início. Toque em <b>Compartilhar</b> (o quadrado com a seta) e em <b>Adicionar à Tela de Início</b>. Depois abra o app pelo ícone novo e toque em <b>Ativar avisos</b>.`;
  else if (typeof Notification === 'undefined' || !('PushManager' in window || 'setAppBadge' in navigator)) return '';
  else if (Notification.permission === 'denied') body = 'Os avisos deste app estão bloqueados no celular. Libere em Ajustes do celular → Notificações → Estoque KF.';
  else { body = `Receba neste celular ${what}.`; btn = `<button class="block" id="pc-on">Ativar avisos</button>`; }
  return `<div class="card push-card" id="push-card">
      <h4>Ative os avisos neste celular</h4>
      <p class="small" id="pc-st" style="margin:0 0 12px">${body}</p>
      ${btn}<button class="block secondary" id="pc-later" style="margin-top:8px">Agora não</button>
    </div>`;
}
function bindPushCard() {
  const on = $('#pc-on'), later = $('#pc-later');
  if (later) later.onclick = () => { try { localStorage.setItem(PUSH_LATER, String(Date.now() + 7 * 864e5)); } catch { /* ignore */ } $('#push-card')?.remove(); };
  if (on) on.onclick = async () => {
    on.disabled = true;
    try {
      if (await activatePush($('#pc-st'))) { on.remove(); later?.remove(); setTimeout(() => $('#push-card')?.remove(), 4000); }
      else on.disabled = false;
    } catch (e) { $('#pc-st').textContent = 'Não foi possível ativar: ' + (e?.message || e); on.disabled = false; }
  };
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
    ...(isOwner() ? [['historico', I.calendar, 'Relatórios']] : []),
    ['ajustes', I.gear, 'Ajustes'],
  ];
  const active = k => r.name === k || (k === 'estoque' && ['produto', 'novo', 'editar', 'codigo'].includes(r.name)) || (k === 'historico' && r.name === 'precos');
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
  ANIM.forEach(c => main().classList.toggle(c, false));
  if (changed) {
    void main().offsetWidth; main().classList.add('enter');
    if (swipeDir) main().classList.add(swipeDir === 'left' ? 'from-right' : 'from-left');
    window.scrollTo(0, 0);
  }
  swipeDir = '';
  switch (r.name) {
    case 'novo': return viewForm(null);
    case 'editar': return viewForm(r.arg);
    case 'produto': return viewProduct(r.arg);
    case 'codigo': return viewBarcode(decodeURIComponent(r.arg || ''));
    case 'pedido': return viewOrder(r.arg);
    case 'estoque': return viewList(r.arg);
    case 'conferencia': return viewCount();
    case 'historico': return isOwner() ? viewHistory() : viewDashboard();
    case 'precos': return isOwner() ? viewPrices() : viewDashboard();
    case 'ajustes': return viewSettings();
    default: return viewDashboard();
  }
}

// ---------- deslizar para os lados ----------
// esquerda = próxima aba; direita = voltar (telas de detalhe) ou aba anterior
let swipeDir = '';
function swipeNav(dir) {
  if (!S.profile) return;
  if (dir === 'right') {
    const back = $('#main a.back');
    if (back) return leaveTo(back.getAttribute('href'), 'right');
  }
  const tabs = $$('#tabs a[data-tab]:not(.disabled)').map(a => a.dataset.tab);
  const i = tabs.indexOf($('#tabs a.on')?.dataset.tab);
  if (i < 0) return;
  // numa tela de detalhe (produto, pedido, preços…) conta a aba a que ela pertence
  const j = i + (dir === 'left' ? 1 : -1);
  if (j < 0 || j >= tabs.length) return nudge(dir);
  leaveTo('#' + tabs[j], dir);
}
function leaveTo(hash, dir) {
  // formulário com alterações não salvas: pergunta antes de sair
  const f = $('#main form#f');
  if (f && f.dataset.dirty && !confirm('Sair sem salvar as alterações?')) return;
  swipeDir = dir;
  go(hash);
}
const ANIM = ['enter', 'from-left', 'from-right', 'nudge-left', 'nudge-right'];
function nudge(dir) {
  const m = main();
  ANIM.forEach(c => m.classList.toggle(c, false)); void m.offsetWidth;
  m.classList.add('nudge-' + dir);
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

// previsão para a lista de compras: dias até acabar e consumo por dia (null sem histórico suficiente)
function forecastOf(p) {
  const c = S.cons.get(p.id);
  const d = forecastDays(p, c);
  return d == null ? null : { days: d, perDay: c.perDay };
}

function fcPill(p) {
  const d = forecastDays(p, S.cons.get(p.id));
  if (d == null || d > 21) return '';
  return `<span class="pill fc ${d <= 7 ? 'red-soft' : 'amber'}" title="${forecastText(d)}">${I.trend}${d <= 0 ? 'acaba hoje' : `~${d} ${d === 1 ? 'dia' : 'dias'}`}</span>`;
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
        <div class="level"><span class="pill ${tone}">${label}</span>${expPill(p)}${fcPill(p)}
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
    const cur = await db.get('products', id);
    const delta = b.dataset.act === 'inc' ? 1 : -1;
    if (cur.quantity + delta < 0) return;
    const p = await setQty(id, cur.quantity + delta, delta > 0 ? 'entrada' : 'saida');
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

// aviso em cima do radar: conferido hoje ou quantas segundas-feiras ficaram sem conferência
function sinceStrip() {
  if (!S.products.length) return '';
  const st = sinceLastCount({ now: now(), counts: S.counts, deadline: S.schedule?.deadline });
  const lastTxt = l => `Última conferência: ${cap(weekday(l.date))}, ${fmtDay(l.date).slice(0, 5)} · ${esc(l.by)}`;
  if (!st.last) return `<div class="since amber"><span class="ic">${I.alert}</span><div><strong>Estoque ainda não foi conferido</strong><small>A primeira conferência aparece aqui.</small></div></div>`;
  if (st.today) return `<div class="since ok"><span class="ic">${I.ok}</span><div><strong>Estoque conferido hoje</strong><small>${fmtTime(st.last.at)} · ${esc(st.last.by)}</small></div></div>`;
  if (!st.days) return `<div class="since gold"><span class="ic">${I.clock}</span><div><strong>${st.pendingToday ? 'Conferência de hoje pendente' : `Próxima conferência: segunda-feira, ${fmtDay(status().next || ymd(now())).slice(0, 5)}`}</strong><small>${lastTxt(st.last)}</small></div></div>`;
  return `<div class="since ${st.days >= 2 ? 'red' : 'amber'}"><b class="n">${st.days}</b><div><strong>${st.days === 1 ? 'segunda-feira' : 'segundas-feiras'} sem conferir o estoque</strong><small>${lastTxt(st.last)}</small></div></div>`;
}

// ---------- tela: painel (radar) ----------
async function viewDashboard() {
  const sm = summary(S.products, now());
  const exp = S.products.filter(p => ['vencido', 'vence-logo'].includes(expiryLevel(p, now()))).sort((a, b) => daysToExpiry(a, now()) - daysToExpiry(b, now()) || byName(a, b));
  const alerts = S.products.filter(isLow).sort((a, b) => (a.quantity - a.min) - (b.quantity - b.min) || byName(a, b));
  const atn = S.products.filter(p => level(p) === 'atencao').sort(byName);
  const inc = S.products.filter(p => missing(p).length).sort(byName);
  const list = shoppingList(S.products, { forecast: forecastOf });
  const openOrders = S.orders.filter(o => o.status === 'feito');
  const months = expiriesByMonth(S.products, now(), 6);
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
    ${pushCard()}
    <section class="radar-card" aria-label="Radar de estoque">
      <div class="face-tap" aria-hidden="true"><div class="shB"><div class="shP"></div></div></div>
      ${sinceStrip()}
      <div class="radar ${sm.alerta ? 'alert' : ''}">${radarSvg(S.products)}
        <div class="ctr"><b id="radar-n">${sm.alerta}</b><span>Em alerta</span></div></div>
      <div class="kpis">
        <a class="kpi red" href="#estoque/alerta"><span><i style="background:#F2A49C"></i>Abaixo do mínimo</span><b>${sm.alerta}</b></a>
        <a class="kpi red" href="#estoque/alerta"><span><i style="background:#E0796F"></i>Esgotados (zerados)</span><b>${sm.esgotado}</b></a>
        <a class="kpi amber" href="#estoque/atencao"><span><i style="background:#EBCB8B"></i>No limite</span><b>${sm.atencao}</b></a>
        <a class="kpi green" href="#estoque/ok"><span><i style="background:#9ED2B5"></i>Em dia</span><b>${sm.ok}</b></a>
        <a class="kpi ${sm.vencido ? 'red' : 'gray'}" href="#estoque/validade"><span><i style="background:#C99A92"></i>Vencidos</span><b>${sm.vencido}</b></a>
        <a class="kpi amber" href="#estoque/validade"><span><i style="background:#E8C27A"></i>Vencem em ${EXPIRY_SOON} dias</span><b>${sm.venceLogo}</b></a>
        <a class="kpi gray" href="#estoque/incompleto"><span><i style="background:#9A9284"></i>Cadastro incompleto</span><b>${sm.incompleto}</b></a>
      </div>
    </section>

    <h3>Radar · abaixo do mínimo (${alerts.length})</h3>
    ${alerts.length ? `<ul class="list" id="alist">${alerts.map(prodRow).join('')}</ul>`
      : `<div class="card empty">${I.ok}<p>Nenhum produto abaixo do mínimo.</p></div>`}

    ${exp.length ? `<h3>Validade · vencidos e a vencer (${exp.length})</h3><ul class="list" id="elist">${exp.map(prodRow).join('')}</ul>` : ''}

    ${list.length ? `
    <h3>Pedido sugerido por fornecedor</h3>
    <p class="small muted sub-lead">Entra o que está abaixo do mínimo e o que vai acabar em até ${FORECAST_HORIZON} dias no ritmo de uso. Com uso registrado, a quantidade cobre ${ORDER_COVER} dias.</p>
    <div class="card" id="shop">
      ${list.map(g => `
        <div class="supplier">
          <div class="hd"><b>${esc(g.supplier)}</b><span class="small muted">${plural(g.items.length, 'item', 'itens')}</span></div>
          ${g.items.map(i => `<a class="it" href="#produto/${i.id}"><span>${esc(i.name)}<small>${i.reason === 'previsao' ? `<b class="fc">Previsão</b> · ${itemNote(i).replace(/, /g, ' · ')}` : cap(itemNote(i)).replace(/, /g, ' · ')}${i.perDay ? ` · uso ${rateText(i.perDay)}` : ''}</small></span><span class="q">comprar ${i.need}</span></a>`).join('')}
          ${(() => { const o = S.orders.find(x => x.status === 'feito' && x.supplier === g.supplier);
            return o ? `<a class="order-tag" href="#pedido/${o.id}">${I.cart}Pedido feito em ${fmtDay(ymd(new Date(o.createdAt))).slice(0, 5)} · ver pedido</a>`
              : `<div class="sup-actions"><a class="btn secondary small-btn" target="_blank" rel="noopener" href="${whatsappUrl(orderText(g.supplier, g.items.map(i => ({ qty: i.need, name: i.name })), now()))}">${I.chat}WhatsApp</a>
                <button type="button" class="small-btn" data-order="${esc(g.supplier)}">${I.cart}Pedido feito</button></div>`; })()}
        </div>`).join('')}
      <button class="block gold" id="share">${I.share}Enviar lista de reposição</button>
    </div>` : ''}

    ${openOrders.length ? `<h3>Pedidos em andamento (${openOrders.length})</h3>
    <div class="card orders">${openOrders.map(o => `<a class="it" href="#pedido/${o.id}"><span>${esc(o.supplier)}<small>${plural(o.items.length, 'item', 'itens')} · feito em ${fmtDay(ymd(new Date(o.createdAt)))} por ${esc(o.createdBy || '—')}</small></span><span class="q gold">Receber</span></a>`).join('')}</div>` : ''}

    ${months.length ? `<h3>Vencimentos por mês</h3>
    <div class="card months">${months.map(m => `<div class="month ${m.overdue ? 'over' : ''}"><div class="mh"><b>${m.overdue ? 'Já vencidos' : cap(monthName(m.month))}</b><span>${plural(m.items.reduce((n, i) => n + i.qty, 0), 'unidade', 'unidades')}</span></div>
      ${m.items.map(i => `<a class="it" href="#produto/${i.id}"><span>${esc(i.name)}</span><span class="q">${i.qty} un · ${fmtDay(i.expiry).slice(0, 5)}</span></a>`).join('')}</div>`).join('')}</div>` : ''}

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
  bindPushCard();
  $$('[data-order]').forEach(b => b.onclick = async () => {
    const g = list.find(x => x.supplier === b.dataset.order);
    if (!g) return;
    const ts = new Date().toISOString();
    const o = { id: uuid(), supplier: g.supplier, status: 'feito', createdAt: ts, createdBy: S.profile.name, updatedAt: ts, _dirty: true,
      items: g.items.map(i => { const pr = S.products.find(x => x.id === i.id); return { id: i.id, name: i.name, qty: i.need, price: pr?.price ?? null }; }) };
    await db.put('orders', o); cloud.syncSoon(); toast(`Pedido para ${g.supplier} registrado.`); render();
  });
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

// ---------- prévia da busca (versão 0.8.1): ao digitar, mostra os produtos que podem ser ----------
function markMatch(name, term) {
  const f = fold(name), toks = fold(term).split(/\s+/).filter(Boolean);
  if (f.length !== name.length || !toks.length) return esc(name);
  const on = new Array(name.length).fill(false);
  for (const t of toks) { const i = f.indexOf(t); if (i >= 0) for (let k = i; k < i + t.length; k++) on[k] = true; }
  let out = '', open = false;
  for (let i = 0; i < name.length; i++) {
    if (on[i] && !open) { out += '<mark>'; open = true; }
    if (!on[i] && open) { out += '</mark>'; open = false; }
    out += esc(name[i]);
  }
  return out + (open ? '</mark>' : '');
}
function showSuggest(q) {
  const box = $('#q-sug');
  if (!box) return;
  if (!fold(q.value) || document.activeElement !== q) { box.classList.add('hidden'); q.setAttribute('aria-expanded', 'false'); return; }
  const all = searchProducts(S.products, q.value);
  const hits = all.slice(0, 6);
  box.innerHTML = hits.length ? hits.map((p, i) => `<a class="sg ${i === 0 ? 'first' : ''}" role="option" href="#produto/${p.id}" data-id="${p.id}">
      <span class="n"><span class="t">${markMatch(p.name, q.value)}</span><small>${esc(p.supplier || 'Sem fornecedor')}</small></span>
      <span class="q ${isLow(p) ? 'red' : ''}">${Number(p.quantity) === 0 ? 'esgotado' : `tem ${p.quantity}`}</span></a>`).join('')
      + (all.length > hits.length ? `<div class="more">Mais ${all.length - hits.length} na lista abaixo</div>` : '')
    : `<div class="more">Nenhum produto com “${esc(q.value.trim())}”</div>`;
  box.classList.remove('hidden');
  q.setAttribute('aria-expanded', 'true');
}
function bindSuggest(q) {
  const box = $('#q-sug');
  // o toque na sugestão abre o produto antes de o campo perder o foco
  box.addEventListener('pointerdown', e => { const a = e.target.closest('a.sg'); if (a) { e.preventDefault(); go('#produto/' + a.dataset.id); } });
  q.addEventListener('focus', () => showSuggest(q));
  q.addEventListener('blur', () => setTimeout(() => showSuggest(q), 150));
  q.addEventListener('keydown', e => {
    if (e.key === 'Escape') q.blur();
    if (e.key === 'Enter') { const a = $('#q-sug a.sg'); if (a) { e.preventDefault(); go('#produto/' + a.dataset.id); } }
  });
}
let pendingBarcode = '';
let pendingName = ''; // nome sugerido pela base pública (versão 0.8.2)
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
    ${S.products.length ? `<div class="search-row">${S.products.length > 1 ? `<div class="search" id="q-box">${I.search}<input type="search" id="q" placeholder="Nome ou fornecedor" value="${esc(searchTerm)}" aria-label="Buscar produto" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="q-sug"></div>` : '<span></span>'}
      <button type="button" class="secondary small-btn" id="l-scan">${I.scan}Ler código</button><div class="suggest hidden" id="q-sug" role="listbox"></div></div>` : ''}
    ${S.products.length ? `<div class="chips" id="filters">${FILTERS.map(([k, t]) =>
      `<button type="button" class="chip ${k === filter ? 'on' : ''} ${k === 'alerta' ? 'red' : ''}" data-f="${k}">${t}<span class="c">${count(k)}</span></button>`).join('')}</div>` : ''}
    ${cats.length > 1 ? `<div class="chips" id="cats"><button type="button" class="chip ${!category ? 'on' : ''}" data-c="">Todas as categorias</button>${cats.map(c =>
      `<button type="button" class="chip ${c === category ? 'on' : ''}" data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}
    ${S.products.length === 0 ? `<div class="card empty">${I.box}<p>Nenhum produto cadastrado ainda.</p><p>Toque em <b>Produto</b> para cadastrar o primeiro.</p></div>` : ''}
    ${S.products.length && !items.length ? `<div class="card empty">${I.ok}<p>Nenhum produto neste filtro.</p></div>` : ''}
    <ul class="list" id="plist">${items.map(prodRow).join('')}</ul>
    <a href="#novo" class="btn fab" id="add">${I.plus}Produto</a>`;
  const applySearch = () => {
    const hits = new Set(searchProducts(S.products, searchTerm).map(p => p.id));
    const on = !!fold(searchTerm);
    $$('#plist li').forEach(li => li.classList.toggle('hidden', on && !hits.has(li.dataset.id)));
  };
  const ls = $('#l-scan');
  if (ls) ls.onclick = async () => {
    const code = await scanBarcode();
    if (!code) return;
    const prod = S.products.find(x => x.barcode === code);
    if (prod) return go('#produto/' + prod.id);
    go('#codigo/' + encodeURIComponent(code));
  };
  const q = $('#q');
  if (q) { q.oninput = () => { searchTerm = q.value; applySearch(); showSuggest(q); }; applySearch(); bindSuggest(q); }
  $$('#filters .chip').forEach(b => { b.onclick = () => go(b.dataset.f === 'todos' ? '#estoque' : '#estoque/' + b.dataset.f); });
  $$('#cats .chip').forEach(b => { b.onclick = () => { category = b.dataset.c; render(); }; });
  bindQty($('#plist'));
  await fillThumbs(main());
}

// ---------- produto: consumo, lotes, entrada e movimentos (versão 0.7) ----------
const MOVE_NAME = { entrada: 'Entrada', saida: 'Saída', ajuste: 'Ajuste', conferencia: 'Conferência', perda: 'Perda (descarte)', preco: 'Preço' };

// ---------- histórico de preços ----------
const dayOf = iso => fmtDay(ymd(new Date(iso)));
function trendHtml(p) {
  const t = priceTrend(priceHistory(S.moves, p.id), p.price);
  if (!t) return '';
  if (t.prev == null) return t.since ? `<small class="tr">Preço desde ${dayOf(t.since)}</small>` : '';
  return `<small class="tr ${t.dir}">Antes ${brl(t.prev)} <em>${t.dir === 'up' ? '▲' : '▼'} ${pctText(t.pct)}</em></small>`;
}
function sparkline(h) {
  const w = 300, ht = 64, pad = 8, ps = h.map(x => x.price), mn = Math.min(...ps), mx = Math.max(...ps), rng = mx - mn || 1;
  const pts = h.map((x, i) => [pad + (w - 2 * pad) * (i / (h.length - 1)), mx === mn ? ht / 2 : ht - pad - (ht - 2 * pad) * ((x.price - mn) / rng)]);
  const line = pts.map(q => q.map(v => v.toFixed(1)).join(',')).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${ht}" preserveAspectRatio="none" aria-hidden="true"><polygon points="${pad},${ht} ${line} ${w - pad},${ht}"/><polyline points="${line}"/></svg>`;
}
function priceDetails(p) {
  const h = priceHistory(S.moves, p.id);
  if (!h.length) return `<p class="small muted ph-empty">Ainda sem histórico. A partir de agora, cada preço novo fica registrado aqui, com a data e o fornecedor.</p>`;
  const ps = h.map(x => x.price);
  const sup = priceBySupplier(h);
  const rev = [...h].reverse().slice(0, 12);
  return `${h.length > 1 ? `${sparkline(h)}<div class="spark-legend"><span>${dayOf(h[0].at)}</span><span>Menor ${brl(Math.min(...ps))} · maior ${brl(Math.max(...ps))}</span><span>hoje</span></div>` : ''}
    <ul class="ph">${rev.map((x, i) => { const prev = rev[i + 1]; const pct = prev && prev.price ? (x.price - prev.price) / prev.price * 100 : null;
      return `<li><span>${dayOf(x.at)}<small>${esc(x.supplier || 'Sem fornecedor')} · ${x.kind === 'entrada' ? 'compra' : 'preço atualizado'}</small></span>
        <b>${brl(x.price)}${pct ? `<em class="${pct > 0 ? 'up' : 'down'}">${pct > 0 ? '▲' : '▼'} ${pctText(pct)}</em>` : ''}</b></li>`; }).join('')}</ul>
    ${sup.length > 1 ? `<div class="ph-sup"><span class="lbl">Comparar fornecedores · último preço</span>${sup.map((x, i) => `<div><span>${esc(x.supplier)}${i === 0 ? ' <span class="pill green">mais barato</span>' : ''}<small>em ${dayOf(x.lastAt)}${x.min < x.last ? ` · já foi ${brl(x.min)}` : ''}</small></span><b>${brl(x.last)}</b></div>`).join('')}</div>` : ''}`;
}
function productExtras(p) {
  const c = S.cons.get(p.id);
  const d = forecastDays(p, c);
  const sug = suggestLevels(c);
  const sugDiff = sug && (sug.min !== Number(p.min) || sug.ideal !== Number(p.ideal));
  const lots = sortedLots(p);
  const loose = Math.max(0, Number(p.quantity) - lotsTotal(p));
  const nd = p.expiry === NO_EXPIRY;
  const moves = S.moves.filter(m => m.productId === p.id && m.type !== 'preco').slice(-8).reverse();
  return `
    <h3>Consumo e previsão</h3>
    <div class="card stats">
      <div class="stat"><span>Consumo médio</span><b>${c && c.used ? rateText(c.perDay) : 'Sem consumo registrado'}</b>
        <small>${c && c.used ? `${c.used} usados nos últimos ${c.days} ${c.days === 1 ? 'dia' : 'dias'}` : 'Aparece quando o estoque for usado (botão −, conferência).'}</small></div>
      <div class="stat"><span>Previsão</span><b class="${d != null && d <= 7 ? 'red' : d != null && d <= 21 ? 'amber' : ''}">${d != null ? forecastText(d) : 'Ainda sem previsão'}</b>
        <small>${d != null ? 'No ritmo de uso atual.' : 'Precisa de pelo menos 1 semana de uso registrado.'}</small></div>
      ${sug ? `<div class="stat wide"><span>Sugestão pelo uso real</span><b>Alerta ${sug.min} · ideal ${sug.ideal}</b>
        <small>Alerta = 1 semana de uso; ideal = 1 mês. Hoje: alerta ${Number(p.min) || '—'}, ideal ${Number(p.ideal) || '—'}.</small>
        ${sugDiff ? `<button type="button" class="secondary small-btn" id="use-sug">Usar sugestão</button>` : ''}</div>` : ''}
    </div>
    <h3>Histórico de preços</h3>
    <div class="card price-hist">${priceDetails(p)}${isOwner() ? `<a class="small-link" href="#precos">${I.money}Atualizar preços de todos os produtos</a>` : ''}</div>
    ${nd ? '' : `
    <h3>Lotes e validade</h3>
    <div class="card">
      ${lots.length ? `<ul class="lots">${lots.map((l, i) => {
        const days = Math.round((Date.parse(l.expiry + 'T12:00:00') - now().getTime()) / 864e5);
        const tone = days < 0 ? 'red' : days <= EXPIRY_SOON ? 'amber' : '';
        return `<li class="${tone}"><div><b>${fmtDay(l.expiry)}</b>${i === 0 ? ' <span class="pill gold">Usar primeiro</span>' : ''}
          <small>${days < 0 ? `Venceu há ${-days} ${-days === 1 ? 'dia' : 'dias'}` : days === 0 ? 'Vence hoje' : `Vence em ${days} ${days === 1 ? 'dia' : 'dias'}`}</small></div>
          <span class="q">${l.qty} un</span>${days < 0 ? `<button type="button" class="danger small-btn" data-discard="${l.id}">Descartar</button>` : ''}</li>`; }).join('')}</ul>`
        : `<p class="muted small" style="margin-top:0">Nenhum lote separado. ${p.expiry ? `Validade única: ${fmtDay(p.expiry)}.` : ''}</p>`}
      ${loose > 0 ? `<p class="small muted">${plural(loose, 'unidade', 'unidades')} sem lote informado.</p>
      <form class="inline-form" id="lot-f"><div class="row"><div><label for="lot-d">Validade do lote</label><input type="date" id="lot-d"></div>
        <div><label for="lot-q">Quantidade</label><input type="number" id="lot-q" inputmode="numeric" min="1" max="${loose}" step="1" value="${loose}"></div></div>
        <button type="submit" class="secondary block">${I.layers}Separar em lote</button></form>` : ''}
    </div>`}
    <h3>Registrar entrada</h3>
    <form class="card inline-form" id="in-f">
      <div class="row"><div><label for="in-q">Quantidade que chegou</label><input type="number" id="in-q" inputmode="numeric" min="1" step="1" placeholder="Ex.: 10"></div>
        <div><label for="in-p">Preço unitário (R$)</label><input type="text" id="in-p" inputmode="decimal" placeholder="Opcional" value="${p.price != null ? Number(p.price).toFixed(2).replace('.', ',') : ''}"></div></div>
      ${nd ? '' : `<label for="in-d">Validade deste lote</label><input type="date" id="in-d">`}
      <div class="hint">Use quando chegar mercadoria fora de um pedido. A quantidade entra no estoque${nd ? '' : ' e o lote passa a contar na validade'}.</div>
      <button type="submit" class="block">${I.inbox}Lançar entrada</button>
    </form>
    ${moves.length ? `<h3>Últimos movimentos</h3>
    <div class="card moves">${moves.map(m => `<div class="mv"><span class="t">${MOVE_NAME[m.type] || m.type}<small>${fmtDateTime(m.at)} · ${esc(m.by)}</small></span>
      <b class="${m.delta < 0 ? 'neg' : 'pos'}">${m.delta > 0 ? '+' : ''}${m.delta}</b></div>`).join('')}</div>` : ''}`;
}

const parsePrice = t => { const v = String(t || '').trim().replace(/\s|R\$/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'); return /^\d+(\.\d{1,2})?$/.test(v) ? Number(v) : null; };

function bindProductExtras(p) {
  const us = $('#use-sug');
  if (us) us.onclick = async () => {
    const sug = suggestLevels(S.cons.get(p.id));
    const cur = await db.get('products', p.id);
    await db.put('products', touch({ ...cur, min: sug.min, ideal: sug.ideal }));
    cloud.syncSoon(); toast(`Alerta ${sug.min} e ideal ${sug.ideal} salvos.`); render();
  };
  $$('[data-discard]').forEach(b => b.onclick = async () => {
    const cur = await db.get('products', p.id);
    const lot = (cur.lots || []).find(l => l.id === b.dataset.discard);
    if (!lot || !confirm(`Descartar ${lot.qty} un vencidas em ${fmtDay(lot.expiry)}? Isso entra como perda no relatório.`)) return;
    const after = Math.max(0, Number(cur.quantity) - Number(lot.qty));
    const m = makeMove(cur, after, 'perda', { note: `Lote vencido em ${fmtDay(lot.expiry)}` });
    const lots = (cur.lots || []).filter(l => l.id !== lot.id);
    const next = touch({ ...cur, quantity: after, lots, expiry: lots.length ? sortedLots({ lots })[0].expiry : (after ? '' : cur.expiry) });
    await db.saveMoves([next], [m]); cloud.syncSoon(); toast('Lote descartado.'); render();
  });
  const lf = $('#lot-f');
  if (lf) lf.onsubmit = async e => {
    e.preventDefault();
    const d = $('#lot-d').value, q = Number($('#lot-q').value);
    const cur = await db.get('products', p.id);
    const loose = Number(cur.quantity) - lotsTotal(cur);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return toast('Informe a validade do lote.');
    if (!(q >= 1 && q <= loose)) return toast(`A quantidade precisa ser de 1 a ${loose}.`);
    await db.put('products', touch(addLot(cur, { id: uuid(), expiry: d, qty: q })));
    cloud.syncSoon(); toast('Lote separado.'); render();
  };
  $('#in-f').onsubmit = async e => {
    e.preventDefault();
    const q = Number($('#in-q').value);
    if (!(Number.isInteger(q) && q >= 1)) return toast('Informe quantas unidades chegaram.');
    const pt = $('#in-p').value.trim();
    const price = pt ? parsePrice(pt) : null;
    if (pt && price == null) return toast('Preço inválido. Use só números, por exemplo 12,50.');
    const d = $('#in-d')?.value || '';
    const cur = await db.get('products', p.id);
    const m = makeMove(cur, Number(cur.quantity) + q, 'entrada', { price: price ?? cur.price ?? null });
    let next = { ...cur, quantity: Number(cur.quantity) + q, price: price ?? cur.price ?? null };
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) next = addLot(next, { id: uuid(), expiry: d, qty: q });
    await db.saveMoves([touch(next)], [m]); cloud.syncSoon(); toast(`Entrada de ${q} lançada.`); render();
  };
}

// ---------- tela: pedido de compra ----------
async function viewOrder(id) {
  const o = S.orders.find(x => x.id === id);
  if (!o) return go('#painel');
  const open = o.status === 'feito';
  const pr = i => S.products.find(x => x.id === i.id);
  main().innerHTML = `
    <a class="back" href="#painel">${I.back}Painel</a>
    <div class="eyebrow">Pedido de compra</div>
    <h2>${esc(o.supplier)}</h2>
    <p class="lead small">Feito em ${fmtDateTime(o.createdAt)} por ${esc(o.createdBy || '—')}.${o.status === 'recebido' ? ` Recebido em ${fmtDateTime(o.receivedAt)} por ${esc(o.receivedBy || '—')}.` : o.status === 'cancelado' ? ' Cancelado.' : ''}</p>
    ${open ? `<div class="banner amber">${I.info}<span>Quando a mercadoria chegar, confira as quantidades, informe a validade de cada item e toque em <b>Recebido</b>. Tudo entra no estoque de uma vez.</span></div>` : ''}
    <form id="rcv" class="card order-items" novalidate>
      ${o.items.map((i, k) => { const p = pr(i); const nd = p?.expiry === NO_EXPIRY; return `
        <div class="oi" data-k="${k}">
          <div class="oh"><b>${esc(i.name)}</b><small>pedido: ${i.qty}${i.price != null ? ` · ${brl(i.price)} un` : ''}${p ? ` · tem ${p.quantity}` : ' · produto excluído'}</small></div>
          ${open && p ? `<div class="row"><div><label>Chegou</label><input type="number" inputmode="numeric" min="0" step="1" class="r-q" value="${i.qty}"></div>
            <div><label>Preço un. (R$)</label><input type="text" inputmode="decimal" class="r-p" value="${i.price != null ? Number(i.price).toFixed(2).replace('.', ',') : ''}" placeholder="Opcional"></div></div>
            ${nd ? '<small class="muted">Sem validade (ND)</small>' : `<label>Validade</label><input type="date" class="r-d">`}`
          : o.status === 'recebido' ? `<small>Recebido: <b>${i.received ?? i.qty}</b></small>` : ''}
        </div>`; }).join('')}
      ${open ? `<div id="rerr" class="banner red hidden"></div><button type="submit" class="block">${I.inbox}Recebido: lançar no estoque</button>` : ''}
    </form>
    ${open ? `<p><a class="btn secondary block" target="_blank" rel="noopener" href="${whatsappUrl(orderText(o.supplier, o.items.map(i => ({ qty: i.qty, name: i.name })), new Date(o.createdAt)))}">${I.chat}Enviar de novo pelo WhatsApp</a></p>
    <p><button type="button" class="block danger" id="o-cancel">Cancelar pedido</button></p>` : ''}`;
  if (!open) return;
  $('#o-cancel').onclick = async () => {
    if (!confirm('Cancelar este pedido?')) return;
    await db.put('orders', { ...o, status: 'cancelado', updatedAt: new Date().toISOString(), _dirty: true });
    cloud.syncSoon(); toast('Pedido cancelado.'); go('#painel');
  };
  $('#rcv').onsubmit = async e => {
    e.preventDefault();
    const err = t => { const b = $('#rerr'); b.textContent = t; b.classList.remove('hidden'); };
    const products = [], moves = [], items = [];
    for (const el of $$('.oi')) {
      const i = o.items[Number(el.dataset.k)];
      const cur = await db.get('products', i.id);
      if (!cur || cur.deleted || !$('.r-q', el)) { items.push({ ...i, received: 0 }); continue; }
      const q = Number($('.r-q', el).value);
      if (!Number.isInteger(q) || q < 0) return err(`Quantidade inválida em ${i.name}.`);
      const pt = $('.r-p', el).value.trim(); const price = pt ? parsePrice(pt) : null;
      if (pt && price == null) return err(`Preço inválido em ${i.name}.`);
      const d = $('.r-d', el)?.value || '';
      if (q > 0 && cur.expiry !== NO_EXPIRY && !d) return err(`Informe a validade de ${i.name} (ou mude a quantidade para 0).`);
      items.push({ ...i, received: q, price: price ?? i.price ?? null });
      if (!q) continue;
      moves.push(makeMove(cur, Number(cur.quantity) + q, 'entrada', { price: price ?? i.price ?? cur.price ?? null, supplier: o.supplier, orderId: o.id }));
      let next = { ...cur, quantity: Number(cur.quantity) + q, price: price ?? cur.price ?? i.price ?? null };
      if (d) next = addLot(next, { id: uuid(), expiry: d, qty: q });
      products.push(touch(next));
    }
    const ts = new Date().toISOString();
    const order = { ...o, items, status: 'recebido', receivedAt: ts, receivedBy: S.profile.name, updatedAt: ts, _dirty: true };
    await db.saveMoves(products, moves, { order });
    cloud.syncSoon();
    toast(`Pedido recebido: ${plural(moves.reduce((n, m) => n + m.delta, 0), 'unidade lançada', 'unidades lançadas')} no estoque.`);
    go('#painel');
  };
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
      <div><span>Preço unitário</span><b class="sm ${p.price != null ? '' : 'muted'}">${p.price != null ? brl(p.price) : 'Não informado'}</b>${trendHtml(p)}</div>
      <div><span>Valor em estoque</span><b class="sm ${p.price != null ? '' : 'muted'}">${p.price != null ? brl(p.price * p.quantity) : '—'}</b></div>
      <div class="wide"><span>Validade</span><b id="f-vl" class="sm ${!p.expiry ? 'miss' : ''} ${{ vencido: 'red', 'vence-logo': 'amber' }[expiryLevel(p, now())] || ''}">${p.expiry === NO_EXPIRY ? 'ND · sem validade' : p.expiry ? `${fmtDay(p.expiry)} <small>· ${expiryText(p, now())}</small>` : 'Não informada'}</b>${(p.lots || []).length ? '' : `<a class="vl-edit" href="#editar/${p.id}">${p.expiry ? 'Alterar validade' : 'Informar validade'}</a>`}</div>
    </div>
    ${productExtras(p)}
    <p class="small muted">Atualizado em ${fmtDateTime(p.updatedAt)}${p.updatedBy ? ' por ' + esc(p.updatedBy) : ''}.</p>
    <p><a class="btn block" href="#editar/${p.id}">${I.edit}Editar produto</a></p>
    <p><button class="block danger" id="del">${I.trash}Excluir produto</button></p>`;
  if (u) {
    $$('.toggle button').forEach(b => b.onclick = () => {
      $$('.toggle button').forEach(x => x.classList.toggle('on', x === b));
      $('#big').src = b.dataset.v === 'orig' ? u.orig : u.line;
    });
  }
  bindProductExtras(p);
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
      <input id="nm" type="text" maxlength="80" value="${esc(p?.name || (!p && pendingName) || '')}" placeholder="Ex.: Luva de procedimento M">
      ${!p && pendingName ? `<div class="hint gold-hint">Nome sugerido pela base pública do código de barras. Confira e ajuste antes de salvar.</div>` : ''}
      <label for="ct">Categoria ${req}</label>
      <input id="ct" type="text" maxlength="40" list="ct-list" value="${esc(p?.category || '')}" placeholder="Ex.: Insumos">
      <datalist id="ct-list">${categories().map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      <label for="fn">Fornecedor ${req}</label>
      <input id="fn" type="text" maxlength="60" list="fn-list" value="${esc(p?.supplier || '')}" placeholder="Ex.: Dental Cremer">
      <datalist id="fn-list">${suppliers().map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      <div class="hint">Onde a clínica compra este produto.</div>
      <div class="row">
        <div><label for="qt">Quantidade atual ${req}</label>
          <input id="qt" type="number" inputmode="numeric" min="0" step="1" value="${p ? p.quantity : ''}"></div>
        <div><label for="mn">Alerta (mínimo) ${req}</label>
          <input id="mn" type="number" inputmode="numeric" min="1" step="1" value="${p && Number(p.min) >= 1 ? p.min : ''}"></div>
      </div>
      <div class="hint">Abaixo do alerta, o produto fica vermelho, entra no radar e você recebe o e-mail.</div>
      ${p && (p.lots || []).length ? `<label>Data de validade</label>
      <div class="lot-note">${I.calendar}<span>Controlada pelos lotes: vence primeiro em <b>${fmtDay(sortedLots(p)[0]?.expiry || p.expiry)}</b>. Veja e altere os lotes na página do produto.</span></div>` : `
      <label for="vl">Data de validade ${req}</label>
      <div class="row vrow">
        <input id="vl" type="date" value="${p?.expiry && p.expiry !== NO_EXPIRY ? esc(p.expiry) : ''}" ${p?.expiry === NO_EXPIRY ? 'disabled' : ''}>
        <label class="nd"><input type="checkbox" id="nd" ${p?.expiry === NO_EXPIRY ? 'checked' : ''}><span>ND</span><small>sem validade</small></label>
      </div>
      <div class="hint">Do lote que está na prateleira (o que vence primeiro). Vencidos ficam vermelhos; a ${EXPIRY_SOON} dias do vencimento o produto entra no radar.</div>`}
      <label for="id">Estoque ideal</label>
      <input id="id" type="number" inputmode="numeric" min="1" step="1" value="${p && Number(p.ideal) >= 1 ? p.ideal : ''}">
      <div class="hint">Opcional. A lista de compras sugere comprar até o ideal.</div>
      <div class="row">
        <div><label for="pr">Preço unitário (R$)</label>
          <input id="pr" type="text" inputmode="decimal" maxlength="12" placeholder="Ex.: 12,50" value="${p?.price != null ? esc(Number(p.price).toFixed(2).replace('.', ',')) : ''}"></div>
        <div><label for="bc">Código de barras</label>
          <div class="bc-row"><input id="bc" type="text" inputmode="numeric" maxlength="40" value="${esc(p?.barcode || pendingBarcode || '')}" placeholder="Opcional">
          <button type="button" class="secondary icon-btn" id="bc-scan" aria-label="Ler código de barras com a câmera">${I.scan}</button></div></div>
      </div>
      ${isOwner() ? `<a class="small-link" href="#precos">${I.money}Atualizar preços de todos os produtos de uma vez</a>` : ''}
      <div class="hint">O preço mostra quanto dinheiro está no estoque e quanto se gasta por mês. O código de barras deixa a conferência mais rápida.</div>
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
  pendingBarcode = ''; pendingName = '';
  $('#bc-scan').onclick = async () => {
    const c = await scanBarcode('Leia o código de barras do produto');
    if (!c) return;
    $('#bc').value = c;
    // produto novo sem nome: tenta sugerir pelo código nas bases públicas
    if (!p && !$('#nm').value.trim() && isRetailCode(c)) {
      const s = await lookupBarcode(c);
      if (s && !$('#nm').value.trim()) { $('#nm').value = sentenceCase(s.name); toast('Nome sugerido pela base pública. Confira antes de salvar.'); }
    }
  };
  if ($('#nd')) $('#nd').onchange = () => { $('#vl').disabled = $('#nd').checked; if ($('#nd').checked) $('#vl').value = ''; $('#vl').dispatchEvent(new Event('input')); };
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
    const cat = sentenceCase($('#ct').value.trim().replace(/\s+/g, ' '));
    const sup = $('#fn').value.trim().replace(/\s+/g, ' ');
    const qt = $('#qt').value.trim(), mn = $('#mn').value.trim();
    const idl = $('#id').value.trim();
    const lotted = !!(p && (p.lots || []).length);
    const nd = !lotted && $('#nd').checked, vl = lotted ? p.expiry : nd ? NO_EXPIRY : $('#vl').value.trim();
    const prTxt = $('#pr').value.trim().replace(/\s|R\$/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
    const bc = $('#bc').value.trim();
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
    if (prTxt && !(/^\d+(\.\d{1,2})?$/.test(prTxt))) return showErr('Preço inválido. Use só números, por exemplo 12,50.', 'pr');
    const dupBc = bc && S.products.find(x => x.id !== p?.id && x.barcode === bc);
    if (dupBc) return showErr(`Esse código de barras já está no produto "${dupBc.name}".`, 'bc');
    $('#save').disabled = true;
    const ts = new Date().toISOString();
    const rec = p ? { ...(await db.get('products', p.id)) } : { id: uuid(), createdAt: ts, createdBy: S.profile.name };
    const oldQty = p ? Number(rec.quantity) : null;
    const oldPrice = p ? (rec.price ?? null) : null;
    Object.assign(rec, { name, category: cat, supplier: sup, min: Number(mn), ideal: idl ? Number(idl) : null, expiry: vl,
      price: prTxt ? Number(prTxt) : null, barcode: bc, updatedAt: ts, updatedBy: S.profile.name });
    const moves = [];
    if (p && Number(qt) !== oldQty) { moves.push(makeMove(rec, Number(qt), 'ajuste', { note: 'Editado no cadastro' })); Object.assign(rec, withQuantity(rec, Number(qt))); }
    else rec.quantity = Number(qt);
    if (rec.price != null && rec.price !== oldPrice) moves.push(makeMove(rec, Number(rec.quantity), 'preco', { note: oldPrice != null ? `Antes ${brl(oldPrice)}` : 'Primeiro preço' }));
    rec._dirty = true;
    if (newPhoto) {
      rec._photoDirty = true;
      rec.photoKey = uuid();
      await db.put('photos', { id: rec.id, original: newPhoto.original, lineart: newPhoto.lineart, key: rec.photoKey });
    }
    await db.saveMoves([rec], moves);
    cloud.syncSoon();
    toast(p ? 'Produto atualizado' : 'Produto cadastrado');
    go('#produto/' + rec.id);
  };
}

// ---------- tela: código de barras sem produto (versão 0.8.2) ----------
// Procura o código nas bases públicas para sugerir o nome; liga o código a um produto existente ou cadastra um novo.
async function viewBarcode(code) {
  if (!code) return go('#estoque');
  const owner = S.products.find(x => x.barcode === code);
  if (owner) return go('#produto/' + owner.id);
  const retail = isRetailCode(code);
  main().innerHTML = `
    <a class="back" href="#estoque">${I.back}Voltar</a>
    <div class="eyebrow">Código de barras</div>
    <h2>Código novo</h2>
    <p class="lead small">O código <b class="mono">${esc(code)}</b> ainda não está em nenhum produto. Ligue a um produto que já existe ou cadastre um novo. Isso é feito uma vez só: depois, ao ler este código, o app abre o produto na hora.</p>
    <div class="card bc-sug" id="bc-sug">${retail
      ? `<div class="bc-wait">${I.search}<span>Procurando o código nas bases públicas…</span></div>`
      : `<p class="small muted" style="margin:0">Este tipo de código não é de produto de varejo, então não há base pública para consultar.</p>`}
      <p style="margin:14px 0 0"><button class="block" id="bc-new">${I.plus}Cadastrar produto novo</button></p></div>
    <h3>Ligar a um produto que já existe</h3>
    <div class="search" id="bl-box">${I.search}<input type="search" id="bl-q" placeholder="Nome ou fornecedor" autocomplete="off" aria-label="Buscar produto para ligar"></div>
    <div class="card bc-list" id="bl-list"></div>`;
  let sug = null;
  const newBtn = () => { $('#bc-new').onclick = () => { pendingBarcode = code; pendingName = sug ? sentenceCase(sug.name) : ''; go('#novo'); }; };
  newBtn();
  const list = () => {
    const t = $('#bl-q').value;
    const base = fold(t) ? searchProducts(S.products, t) : [...S.products].sort((a, b) => (!!a.barcode - !!b.barcode) || byName(a, b));
    $('#bl-list').innerHTML = base.length ? base.slice(0, 30).map(p => `<button type="button" class="bl-it" data-id="${p.id}">
        <span><span class="t">${fold(t) ? markMatch(p.name, t) : esc(p.name)}</span><small>${esc(p.supplier || 'Sem fornecedor')}${p.barcode ? ' · já tem outro código' : ''}</small></span><span class="go">Ligar</span></button>`).join('')
      : `<p class="small muted" style="margin:0">Nenhum produto com “${esc(t.trim())}”.</p>`;
    $$('#bl-list .bl-it').forEach(b => b.onclick = async () => {
      const p = await db.get('products', b.dataset.id);
      if (!p) return;
      if (p.barcode && p.barcode !== code && !confirm(`"${p.name}" já tem o código ${p.barcode}. Trocar pelo código ${code}?`)) return;
      await db.saveMoves([{ ...p, barcode: code, updatedAt: new Date().toISOString(), updatedBy: S.profile.name, _dirty: true }], []);
      cloud.syncSoon();
      toast(`Código ligado a ${p.name}.`);
      go('#produto/' + p.id);
    });
  };
  $('#bl-q').oninput = list;
  list();
  if (!retail) return;
  sug = await lookupBarcode(code);
  if (route().name !== 'codigo') return; // a pessoa saiu da tela enquanto procurava
  const box = $('#bc-sug');
  if (sug) {
    box.innerHTML = `<div class="bc-found">${sug.image ? `<img src="${esc(sug.image)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
        <div><span class="lbl">Sugestão da base pública</span><b>${esc(sentenceCase(sug.name))}</b><small>${sug.brand ? esc(sug.brand) + ' · ' : ''}${esc(sug.source)}</small></div></div>
      <p style="margin:14px 0 0"><button class="block" id="bc-new">${I.plus}Cadastrar com este nome</button></p>
      <p class="small muted" style="margin:10px 0 0">Confira o nome antes de salvar: as bases públicas são preenchidas por voluntários.</p>`;
    // a busca de produto existente começa pelo que mais parece com a sugestão
    const first = sentenceCase(sug.name).split(' ')[0];
    if (!$('#bl-q').value && searchProducts(S.products, first).length) { $('#bl-q').value = first; list(); }
  } else {
    box.innerHTML = `<p class="small muted" style="margin:0">Não achei este código nas bases públicas (Open Food Facts e similares). É comum com material de clínica.</p>
      <p style="margin:14px 0 0"><button class="block" id="bc-new">${I.plus}Cadastrar produto novo</button></p>`;
  }
  newBtn();
}

// ---------- tela: conferência ----------
const draftKey = () => 'kf-contagem-' + ymd(now());
function loadDraft() { try { return JSON.parse(localStorage.getItem(draftKey()) || '{}'); } catch { return {}; } }
function saveDraft(d) { try { localStorage.setItem(draftKey(), JSON.stringify(d)); } catch { /* sem espaço */ } }

async function viewJustify(st) {
  main().innerHTML = `
    <div class="banner lock">${I.lock}<span><b>Conferência não feita.</b> A contagem é toda segunda-feira. Explique o motivo para liberar o app.</span></div>
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
    const offline = !navigator.onLine;
    const rec = { id: uuid(), date: ymd(now()), at: now().toISOString(), by: S.profile.name, role: S.profile.role, items: [], justification: text, days: st.missing, _dirty: true, ...(offline ? { _offline: true } : {}) };
    await db.put('counts', rec);
    cloud.syncSoon();
    toast(offline ? 'Justificativa salva neste celular. Ela vai para o dono quando a internet voltar.' : 'Justificativa enviada ao dono.');
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
    else if (st.state === 'primeiro-dia') msg = 'Os produtos foram cadastrados hoje. A conferência obrigatória começa na próxima segunda-feira.';
    else if (st.state === 'nao-iniciada') msg = `A primeira conferência será em ${fmtDay(st.next)} (${weekday(st.next)}).`;
    else if (st.state === 'fim-de-semana') msg = `Hoje não é dia de conferência. A contagem é toda segunda-feira; a próxima é em ${fmtDay(st.next)}.`;
    else if (st.missing?.length) msg = `Conferência de hoje feita. Ainda falta a justificativa de ${plural(st.missing.length, 'segunda-feira', 'segundas-feiras')} sem conferência.`;
    else msg = `Conferência de hoje feita por <b>${esc(st.count.by)}</b> em ${fmtDateTime(st.count.at)}.`;
    main().innerHTML = `
      <div class="eyebrow">Conferência</div>
      <h2>Contagem do estoque</h2>
      <div class="banner green">${I.ok}<span>${msg}</span></div>
      <div class="card">
        <p style="margin-top:0">Próxima conferência: <b>${fmtDay(st.next)}</b> (${weekday(st.next)}).</p>
        <p class="small muted" style="margin-bottom:0">A conferência é semanal, toda segunda-feira. Segunda-feira sem conferência precisa de justificativa.${isCountWeekday(today) ? '' : ' Fora da segunda, a contagem é opcional.'}</p>
      </div>
      ${products.length ? `<button class="block secondary" id="extra">Fazer uma contagem extra agora</button>` : ''}`;
    const ex = $('#extra');
    if (ex) ex.onclick = () => viewCount(true);
    return;
  }
  const draft = loadDraft();
  // sugestões aceitas da contagem por foto (versão 0.9): id -> { validade, lote, updateExpiry }
  const photoInfo = draft.__foto || {};
  const plan = countPlan(products, S.moves, now(), p => ['esgotado', 'critico', 'atencao'].includes(level(p)));
  const tag = x => x.near ? '<span class="pill amber">Atenção</span>' : x.used ? '<span class="pill gray">Mais usado</span>' : x.moved7 ? '<span class="pill gray">Mexido esta semana</span>' : '';
  const item = (x, withTag) => { const p = x.p; return `
        <li class="count-item" data-id="${p.id}">
          ${thumbHtml(p)}
          <div class="info">${esc(p.name)}${p.supplier ? `<small>${esc(p.supplier)}</small>` : ''}${withTag ? tag(x) : ''}<span class="pill gold photo-tag${photoInfo[p.id] ? '' : ' hidden'}">Pela foto</span></div>
          <input type="number" inputmode="numeric" enterkeyhint="next" min="0" step="1" placeholder="?" aria-label="Quantidade de ${esc(p.name)}" value="${esc(draft[p.id] ?? '')}">
        </li>`; };
  const split = plan.first.length && plan.later.length;
  main().innerHTML = `
    ${st.locked && !isOwner() ? `<div class="banner lock">${I.lock}<span><b>Conferência de segunda-feira.</b> Conte todos os produtos para liberar o app.</span></div>` : ''}
    ${st.state === 'atrasada' ? `<div class="banner red">${I.alert}<span>Conferência atrasada: o prazo de hoje (${esc(S.schedule?.deadline || '18:00')}) já passou.</span></div>` : ''}
    <div class="banner amber offline-note${navigator.onLine ? ' hidden' : ''}" id="c-off">${I.info}<span><b>Sem internet.</b> Pode contar normalmente: a conferência fica salva neste celular e é enviada sozinha quando a internet voltar.</span></div>
    <div class="eyebrow">Conferência</div>
    <h2>Contagem do estoque</h2>
    <p class="muted small">Conte cada produto e digite a quantidade que existe de verdade na prateleira.</p>
    <div class="count-tools"><div class="small"><b id="done-n">0</b> de ${products.length} contados</div>
      <div class="ct-btns">
      ${products.some(p => p.barcode) ? `<button type="button" class="secondary small-btn" id="c-scan">${I.scan}Ler código</button>` : ''}</div></div>
    <div class="photo-count card">
      <h4>Contar por foto</h4>
      <p class="small muted" style="margin:0 0 12px">Uma foto por prateleira: o app sugere as quantidades, a validade e o lote, e você confere.</p>
      <div class="pc-btns"><button type="button" class="secondary small-btn" id="c-photo">${I.camera}Tirar foto</button>
      <button type="button" class="secondary small-btn" id="c-album">${I.image}Escolher do álbum</button></div>
    </div>
    <input type="file" accept="image/*" capture="environment" id="c-photo-in" class="hidden">
    <input type="file" accept="image/*" id="c-album-in" class="hidden">
    <div class="progress"><div id="bar" style="width:0%"></div></div>
    <div id="clist">
      ${split ? `<div class="count-sec"><h3>Conferir primeiro <span class="muted h-n">${plan.first.length}</span></h3>
        <p class="small muted">Os que mais mudam e os que estão perto do mínimo. É onde a contagem costuma errar, então conte com calma.</p></div>` : ''}
      <ul class="list">${(split ? plan.first : [...plan.first, ...plan.later].sort((a, b) => byName(a.p, b.p))).map(x => item(x, split)).join('')}</ul>
      ${split ? `<div class="count-sec"><h3>Pouco movimento <span class="muted h-n">${plan.later.length}</span></h3>
        <p class="small muted">Quase não mudaram no último mês.</p></div>
      <ul class="list">${plan.later.map(x => item(x, false)).join('')}</ul>` : ''}
    </div>
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
    if (Object.keys(photoInfo).length) d.__foto = photoInfo;
    saveDraft(d);
    $('#done-n').textContent = n;
    $('#bar').style.width = (products.length ? 100 * n / products.length : 0) + '%';
    $('#finish').disabled = n !== products.length;
  };
  $('#clist').oninput = update;
  const cin = $$('#clist input');
  cin.forEach((inp, i) => inp.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const next = cin.slice(i + 1).find(x => x.value.trim() === '') || cin[i + 1];
    if (next) { next.focus(); next.closest('li').scrollIntoView({ block: 'center', behavior: 'smooth' }); } else inp.blur();
  }));
  update();
  // ---- contagem por foto ----
  const pickPhoto = inp => () => {
    if (!navigator.onLine) return toast('A contagem por foto precisa de internet. Sem internet, conte e digite normalmente.');
    inp.value = ''; inp.click();
  };
  $('#c-photo').onclick = pickPhoto($('#c-photo-in'));
  $('#c-album').onclick = pickPhoto($('#c-album-in'));
  const onPhoto = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const close = overlay('Analisando a foto… (leva uns 30 segundos)');
    let res;
    try {
      const jpeg = await shelfJpeg(file);
      res = await cloud.photoCount(jpeg, products);
    } catch (e) { close(); return toast('Contagem por foto: ' + (e?.message || e)); }
    close();
    photoReview(res);
  };
  $('#c-photo-in').onchange = onPhoto;
  $('#c-album-in').onchange = onPhoto;
  const photoReview = res => {
    const byId = new Map(products.map(p => [p.id, p]));
    const items = (res.itens || []).filter(i => byId.has(i.produto_id));
    const certeza = { alta: ['Certeza alta', 'green'], media: ['Confira', 'amber'], baixa: ['Pouca certeza', 'red'] };
    const expTxt = v => v.length === 7 ? `${v.slice(5)}/${v.slice(0, 4)}` : fmtDay(v);
    const sheet = document.createElement('div');
    sheet.className = 'photo-sheet';
    sheet.innerHTML = `<div class="ps-box" role="dialog" aria-label="Sugestões da foto">
      <h3 style="margin-top:0">O que a foto mostrou</h3>
      ${items.length ? `<p class="small muted">Confira cada número antes de usar. Você pode corrigir aqui ou depois na lista.</p>
      <ul class="list ps-list">${items.map(i => { const p = byId.get(i.produto_id); const [ct, tone] = certeza[i.certeza] || certeza.baixa;
        const cur = p.expiry && /^\d{4}-/.test(p.expiry) ? p.expiry : '';
        const showExp = i.validade && i.validade.length === 10 && i.validade !== cur;
        return `<li data-id="${p.id}">
          <label class="ps-use"><input type="checkbox" checked aria-label="Usar ${esc(p.name)}"></label>
          <div class="info">${esc(p.name)}<small><span class="pill ${tone}">${ct}</span>${i.validade ? ` Validade ${expTxt(i.validade)}` : ''}${i.lote ? ` · Lote ${esc(i.lote)}` : ''}</small>
            ${i.obs ? `<small class="muted">${esc(i.obs)}</small>` : ''}
            ${showExp ? `<label class="small ps-exp"><input type="checkbox" class="ps-upd"${cur ? '' : ' checked'}> Atualizar validade do cadastro para ${fmtDay(i.validade)}${cur ? ` (hoje ${fmtDay(cur)})` : ''}</label>` : ''}</div>
          <input type="number" inputmode="numeric" min="0" step="1" value="${i.quantidade}" aria-label="Quantidade de ${esc(p.name)}">
        </li>`; }).join('')}</ul>` : `<p>Nenhum produto cadastrado foi reconhecido nesta foto. Tente de mais perto, com boa luz e os rótulos virados para a câmera.</p>`}
      ${res.outros?.length ? `<p class="small muted">Também apareceu na foto (não cadastrado): ${res.outros.map(esc).join(', ')}.</p>` : ''}
      ${items.length ? `<button class="block" id="ps-ok">Usar estas quantidades</button>` : ''}
      <button class="block secondary" id="ps-cancel" style="margin-top:8px">${items.length ? 'Descartar' : 'Fechar'}</button>
    </div>`;
    document.body.appendChild(sheet);
    $('#ps-cancel', sheet).onclick = () => sheet.remove();
    const ok = $('#ps-ok', sheet);
    if (ok) ok.onclick = () => {
      let n = 0;
      for (const li of $$('.ps-list li', sheet)) {
        if (!$('.ps-use input', li).checked) continue;
        const v = $('input[type=number]', li).value.trim();
        if (!/^\d+$/.test(v)) continue;
        const target = $(`#clist li[data-id="${li.dataset.id}"]`);
        if (!target) continue;
        $('input', target).value = v;
        const it = items.find(x => x.produto_id === li.dataset.id);
        photoInfo[li.dataset.id] = { validade: it.validade, lote: it.lote, updateExpiry: !!$('.ps-upd', li)?.checked };
        $('.photo-tag', target).classList.remove('hidden');
        target.classList.add('flash'); setTimeout(() => target.classList.remove('flash'), 1600);
        n++;
      }
      sheet.remove();
      update();
      toast(n ? `${plural(n, 'quantidade preenchida', 'quantidades preenchidas')} pela foto. Confira e tire a foto da próxima prateleira.` : 'Nada foi usado.');
    };
  };
  const cs = $('#c-scan');
  if (cs) cs.onclick = async () => {
    const code = await scanBarcode('Leia o código do produto que vai contar');
    if (!code) return;
    const prod = products.find(x => x.barcode === code);
    if (!prod) return toast('Esse código não está em nenhum produto.');
    const li = $(`#clist li[data-id="${prod.id}"]`);
    li.scrollIntoView({ block: 'center', behavior: 'smooth' });
    li.classList.add('flash'); setTimeout(() => li.classList.remove('flash'), 1600);
    $('input', li).focus();
  };
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
    const moves = [];
    for (const p of fresh) {
      if (!(p.id in values)) continue; // produto criado durante a contagem
      const ph = photoInfo[p.id];
      items.push({ productId: p.id, name: p.name, before: p.quantity, counted: values[p.id],
        ...(ph ? { foto: true, ...(ph.validade ? { validade: ph.validade } : {}), ...(ph.lote ? { lote: ph.lote } : {}) } : {}) });
      if (values[p.id] !== Number(p.quantity)) moves.push(makeMove(p, values[p.id], 'conferencia'));
      const next = { ...withQuantity(p, values[p.id]), updatedAt: at, updatedBy: S.profile.name, _dirty: true };
      if (ph?.updateExpiry && /^\d{4}-\d{2}-\d{2}$/.test(ph.validade || '')) next.expiry = ph.validade;
      updated.push(next);
    }
    const offline = !navigator.onLine;
    const count = { id: uuid(), date: ymd(now()), at: now().toISOString(), by: S.profile.name, role: S.profile.role, items, _dirty: true, ...(offline ? { _offline: true } : {}) };
    await db.saveMoves(updated, moves, { count });
    cloud.syncSoon();
    try { localStorage.removeItem(draftKey()); } catch { /* ignore */ }
    const lowNow = updated.filter(isLow).length;
    toast(offline ? 'Conferência salva neste celular. Ela será enviada sozinha quando a internet voltar.'
      : `Conferência concluída. App liberado.${lowNow ? ` ${plural(lowNow, 'produto ficou', 'produtos ficaram')} abaixo do mínimo.` : ''}`);
    go('#estoque');
  };
  await fillThumbs(main());
}

// ---------- tela: histórico (dono) ----------
let reportMonth = '';
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
  const month = reportMonth || monthKey(now().toISOString());
  const thisMonth = monthKey(now().toISOString());
  const shift = (m, k) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + k, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const ms = monthSummary(S.moves, month);
  const sv = stockValue(S.products);
  const mrows = S.schedule ? history({ now: now(), start: S.schedule.startDate, deadline: S.schedule.deadline, counts: S.counts, productDays: S.products.map(p => ymd(new Date(p.createdAt))), limit: 31 })
    .filter(r => r.day.startsWith(month) && r.state !== 'sem-cobranca' && r.day !== ymd(now())) : [];
  const cFeitas = mrows.filter(r => r.state === 'feita').length, cJust = mrows.filter(r => r.state === 'justificada').length, cNao = mrows.filter(r => r.state === 'nao-feita').length;
  const mOrders = S.orders.filter(o => monthKey(o.createdAt) === month && o.status !== 'cancelado');
  main().innerHTML = `
    ${countBanner()}
    <div class="eyebrow">Relatórios</div>
    <h2>Resumo do mês</h2>
    <div class="month-nav"><button type="button" class="secondary icon-btn" id="m-prev" aria-label="Mês anterior">‹</button>
      <b>${cap(monthName(month))}</b>
      <button type="button" class="secondary icon-btn" id="m-next" aria-label="Próximo mês" ${month >= thisMonth ? 'disabled' : ''}>›</button></div>
    <div class="kpi-grid">
      <div class="kcard"><span>${I.money}Valor em estoque hoje</span><b>${brl(sv.value)}</b><small>${sv.missing ? `${plural(sv.missing, 'produto', 'produtos')} sem preço` : '<a href="#precos" id="go-prices">Todos com preço · revisar</a>'}</small></div>
      <div class="kcard"><span>${I.cart}Gasto no mês</span><b>${brl(ms.spend)}</b><small>Entradas de mercadoria</small></div>
      <div class="kcard ${ms.losses ? 'bad' : ''}"><span>${I.trash}Perdas (vencidos)</span><b>${brl(ms.losses)}</b><small>${plural(ms.lossUnits, 'unidade descartada', 'unidades descartadas')}</small></div>
      <div class="kcard ${cNao ? 'bad' : ''}"><span>${I.check}Conferências</span><b>${cFeitas} de ${mrows.length}</b><small>segundas-feiras${cJust ? ` · ${cJust} justificado${cJust > 1 ? 's' : ''}` : ''}${cNao ? ` · ${cNao} sem justificativa` : ''}</small></div>
    </div>
    ${sv.missing ? `<a class="btn secondary block fill-prices" href="#precos" id="fill-prices">${I.money}Preencher preços (${sv.missing} faltando)</a>` : ''}
    ${ms.bySupplier.length ? `<h3>Gasto por fornecedor</h3><div class="card bars">${ms.bySupplier.map(x => `<div class="br"><div class="t"><span>${esc(x.supplier)}</span><b>${brl(x.value)}</b></div>
      <div class="b"><i style="width:${ms.spend ? Math.max(3, Math.round(100 * x.value / ms.spend)) : 0}%"></i></div><small>${plural(x.units, 'unidade', 'unidades')}</small></div>`).join('')}</div>` : ''}
    ${ms.usage.length ? `<h3>Mais usados no mês</h3><div class="card bars">${ms.usage.slice(0, 10).map(u => `<div class="br"><div class="t"><span>${esc(u.name)}</span><b>${u.units} un</b></div>
      <div class="b"><i style="width:${Math.max(3, Math.round(100 * u.units / ms.usage[0].units))}%"></i></div>${u.value ? `<small>${brl(u.value)}</small>` : ''}</div>`).join('')}</div>` : ''}
    ${mOrders.length ? `<h3>Pedidos do mês</h3><div class="card orders">${mOrders.map(o => `<a class="it" href="#pedido/${o.id}"><span>${esc(o.supplier)}<small>${fmtDay(ymd(new Date(o.createdAt)))} · ${plural(o.items.length, 'item', 'itens')}</small></span><span class="q ${o.status === 'recebido' ? 'ok' : 'gold'}">${o.status === 'recebido' ? 'Recebido' : 'Em andamento'}</span></a>`).join('')}</div>` : ''}
    ${!ms.spend && !ms.usage.length && !mOrders.length ? `<p class="muted small">Ainda não há movimentos neste mês. O resumo se preenche conforme o estoque é usado, recebido e conferido.</p>` : ''}
    <h3>Relatório em PDF</h3>
    <div class="card">
      <p class="small muted" style="margin-top:0">Todo dia 1º, o relatório do mês anterior chega no seu e-mail. Você também pode baixar ou enviar agora.</p>
      <div class="row"><button type="button" class="secondary" id="pdf-dl">${I.download}Baixar PDF</button><button type="button" class="secondary" id="pdf-mail">${I.mail}Enviar por e-mail</button></div>
      <p class="small muted hidden" id="pdf-st" style="margin-bottom:0"></p>
    </div>
    <h2 style="margin-top:44px">Conferências</h2>
    <div class="card small">Conferência semanal, toda segunda-feira, desde ${S.schedule ? fmtDay(S.schedule.startDate) : '—'}. Prazo: ${esc(S.schedule?.deadline || '18:00')}. Segunda-feira sem conferência precisa de justificativa.</div>
    <h3>Por segunda-feira</h3>
    ${rows.length ? `<div class="card" style="padding:4px 12px"><table class="hist days"><tbody>
      ${rows.map(r => `<tr><td>${fmtDay(r.day)}<br><span class="muted small">${cap(weekday(r.day))}</span></td>
        <td><b class="st ${label[r.state][1]}">${label[r.state][0]}</b><br><span class="who-when">${r.count ? `${esc(r.count.by)}<br><span class="muted small">${fmtDateTime(r.count.at)}</span>`
          : r.justification ? `${esc(r.justification.by)}: “${esc(r.justification.justification)}”<br><span class="muted small">${fmtDateTime(r.justification.at)}</span>` : ''}</span></td></tr>`).join('')}
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
  $('#m-prev').onclick = () => { reportMonth = shift(month, -1); render(); };
  $('#m-next').onclick = () => { if (month < thisMonth) { reportMonth = shift(month, 1); render(); } };
  const pst = t => { const e = $('#pdf-st'); e.textContent = t; e.classList.remove('hidden'); };
  $('#pdf-dl').onclick = async () => {
    pst('Gerando o PDF…');
    try {
      const blob = await cloud.reportPdf(month);
      const file = new File([blob], `estoque-kf-${month}.pdf`, { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Relatório do estoque' }).catch(() => {}); }
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); }
      pst('PDF pronto.');
    } catch (e) { pst('Não foi possível gerar o PDF: ' + cloud.errorText(e)); }
  };
  $('#pdf-mail').onclick = async () => {
    pst('Enviando…');
    try { const r = await cloud.reportEmail(month); pst(`Relatório enviado para ${r.para || 'o seu e-mail'}.`); }
    catch (e) { pst('Não foi possível enviar: ' + cloud.errorText(e)); }
  };
}

// ---------- tela: ajustes ----------
// ---------- tela: preços (preencher de uma vez, comparar antes e agora) ----------
let priceFilter = null;
const PRICE_FILTERS = [['falta', 'Sem preço'], ['todos', 'Todos'], ['subiu', 'Subiram'], ['baixou', 'Baixaram']];
async function viewPrices() {
  const trend = p => priceTrend(priceHistory(S.moves, p.id), p.price);
  const matches = (p, f) => f === 'todos' || (f === 'falta' ? p.price == null : trend(p)?.dir === (f === 'subiu' ? 'up' : 'down'));
  const counts = () => Object.fromEntries(PRICE_FILTERS.map(([k]) => [k, S.products.filter(p => matches(p, k)).length]));
  let c = counts();
  if (!priceFilter || (priceFilter !== 'todos' && !c[priceFilter])) priceFilter = c.falta ? 'falta' : 'todos';
  const shown = S.products.filter(p => matches(p, priceFilter));
  const groups = [...new Set(shown.map(p => p.supplier || 'Sem fornecedor'))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
    .map(g => [g, shown.filter(p => (p.supplier || 'Sem fornecedor') === g).sort(byName)]);
  const fmt = v => v == null ? '' : Number(v).toFixed(2).replace('.', ',');
  const hasHist = p => priceHistory(S.moves, p.id).length > 0;
  main().innerHTML = `
    <a href="#historico" class="back">${I.back}Relatórios</a>
    <div class="eyebrow">Custo do estoque</div>
    <h2>Preços dos produtos</h2>
    <div class="card price-sum" id="psum"></div>
    <div class="chips" id="pf">${PRICE_FILTERS.map(([k, t]) => `<button type="button" class="chip ${k === priceFilter ? 'on' : ''} ${k === 'subiu' ? 'red' : ''}" data-f="${k}">${t}<span class="c" data-n="${k}">${c[k]}</span></button>`).join('')}</div>
    <p class="small muted">Digite o preço de uma unidade e toque em "Próximo". Cada preço é salvo na hora e fica no histórico, para comparar com o anterior, com outras datas e com outros fornecedores.</p>
    ${!shown.length ? `<div class="card empty">${I.ok}<p>${priceFilter === 'falta' ? 'Todos os produtos já têm preço.' : 'Nenhum produto neste filtro.'}</p></div>` : ''}
    ${groups.map(([g, ps]) => `<h3>${esc(g)} <span class="muted h-n">${ps.length}</span></h3><div class="card price-list">${ps.map(p => `
      <div class="pr-row" data-id="${p.id}">
        <label class="nm" for="pi-${p.id}">${esc(p.name)}<small>${p.quantity} em estoque</small><span class="trw">${trendHtml(p)}</span></label>
        <span class="pin"><i>R$</i><input id="pi-${p.id}" type="text" inputmode="decimal" enterkeyhint="next" autocomplete="off" placeholder="0,00" value="${fmt(p.price)}"></span>
        <b class="st" aria-live="polite"></b>
        <button type="button" class="ph-tog ${hasHist(p) ? '' : 'hidden'}" aria-expanded="false">${I.trend}<span>Histórico</span></button>
        <div class="ph-box hidden"></div>
      </div>`).join('')}</div>`).join('')}`;
  const sum = () => {
    const sv = stockValue(S.products), n = S.products.length - sv.missing;
    c = counts();
    $('#psum').innerHTML = `<div><span>Com preço</span><b>${n} de ${S.products.length}</b></div><div><span>Valor em estoque</span><b>${brl(sv.value)}</b></div>
      ${c.subiu || c.baixou ? `<div class="wide"><span class="up">▲ ${plural(c.subiu, 'subiu', 'subiram')}</span><span class="down">▼ ${plural(c.baixou, 'baixou', 'baixaram')}</span><small>comparado com o preço anterior de cada produto</small></div>` : ''}`;
    $$('#pf [data-n]').forEach(e => { e.textContent = c[e.dataset.n]; });
  };
  sum();
  $$('#pf .chip').forEach(b => b.onclick = () => { priceFilter = b.dataset.f; render(); });
  $$('.ph-tog').forEach(b => b.onclick = () => {
    const row = b.closest('.pr-row'), box = $('.ph-box', row), open = box.classList.contains('hidden');
    if (open) box.innerHTML = priceDetails(S.products.find(x => x.id === row.dataset.id));
    box.classList.toggle('hidden', !open); b.setAttribute('aria-expanded', String(open));
  });
  const inputs = $$('.pr-row input');
  inputs.forEach((inp, i) => {
    const row = inp.closest('.pr-row'), st = $('.st', row), id = row.dataset.id;
    let queue = Promise.resolve();
    // Enter e a saída do campo disparam juntos: grava um de cada vez para não duplicar o histórico
    const save = () => (queue = queue.then(doSave).catch(e => console.error(e)));
    const doSave = async () => {
      const t = inp.value.trim();
      const price = t ? parsePrice(t) : null;
      row.classList.toggle('bad', !!t && price == null);
      if (t && price == null) { st.textContent = 'Inválido'; return; }
      const cur = await db.get('products', id);
      if (!cur || (cur.price ?? null) === price) { if (st.textContent === 'Inválido') st.textContent = ''; return; }
      const next = touch({ ...cur, price });
      const moves = price != null ? [makeMove(next, Number(cur.quantity), 'preco', { note: cur.price != null ? `Antes ${brl(cur.price)}` : 'Primeiro preço' })] : [];
      await db.saveMoves([next], moves);
      S.moves.push(...moves);
      const k = S.products.findIndex(x => x.id === id); if (k >= 0) S.products[k] = next;
      inp.value = fmt(price); st.innerHTML = `${I.ok}<span>Salvo</span>`;
      $('.trw', row).innerHTML = trendHtml(next);
      $('.ph-tog', row).classList.toggle('hidden', !hasHist(next));
      const box = $('.ph-box', row); if (!box.classList.contains('hidden')) box.innerHTML = priceDetails(next);
      sum(); cloud.syncSoon();
    };
    inp.addEventListener('change', save);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); if (inputs[i + 1]) inputs[i + 1].focus(); else inp.blur(); } });
  });
}

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
        <div class="hint">A partir desse dia, a conferência é toda segunda-feira.</div>
        <label for="dl">Horário limite</label>
        <input id="dl" type="time" value="${esc(S.schedule?.deadline || '18:00')}">
        <div class="hint">Passado esse horário sem conferência, ela aparece como atrasada e você recebe um aviso no celular e por e-mail. Segunda-feira que terminar sem conferência precisa de justificativa do funcionário.</div>
        <p style="margin-bottom:0"><button class="block">Salvar conferência</button></p>
      </form>
    </div>
    <h3>Pessoas com acesso</h3>
    <div class="card"><div id="members" class="small muted">Carregando…</div></div>` : ''}
    <h3>Notificações e número no ícone</h3>
    <div class="card small">
      <p style="margin-top:0">${isOwner() ? 'Receba no celular um aviso a cada mudança no estoque e, na segunda-feira, um resumo às 8h, o lembrete da conferência às 17h e um aviso se a conferência passar do horário limite. O número no ícone do app mostra quantos produtos estão abaixo do alerta (inclui os esgotados) ou vencidos, mesmo com o app fechado.' : 'Receba na segunda-feira, às 17h, o lembrete quando a conferência ainda não foi feita. O número no ícone do app mostra quantos produtos estão abaixo do alerta ou vencidos.'}</p>
      <p id="push-st" class="muted">${pushStatusText()}</p>
      ${pushCanAsk() ? `<p style="margin-bottom:0"><button class="block secondary" id="push-on">Ativar notificações</button></p>` : ''}
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
      if (await activatePush(st)) po.remove(); else po.disabled = false;
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
    const phones = await cloud.pushSummary().catch(() => null);
    const pushTxt = id => { if (!phones) return ''; const n = phones.get(id) || 0; return `<br><span class="${n ? 'ok-ink' : 'muted'}">${n ? `Avisos ligados em ${plural(n, 'celular', 'celulares')}` : 'Avisos desligados'}</span>`; };
    $('#members').innerHTML = list.map(m => `
      <div class="row" style="padding:8px 0;border-bottom:1px solid var(--line)">
        <div><b style="color:var(--text);font-weight:500">${esc(m.nome)}</b> <span>(${m.papel === 'dono' ? 'dono' : 'funcionário'})</span>${pushTxt(m.user_id)}</div>
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
// tocar de novo (ou dois toques) na aba em que você já está volta ao topo da tela, como no iPhone
$('#tabs').addEventListener('click', e => {
  const a = e.target.closest('a[data-tab]');
  if (!a) return;
  const cur = location.hash.replace(/^#\/?/, '') || 'painel';
  if (cur === a.dataset.tab) { e.preventDefault(); window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }
});
$('#ver').textContent = 'versão ' + APP_VERSION;
document.documentElement.style.setProperty('--tap-deep', tapURI(15, 'deep'));
document.documentElement.style.setProperty('--tap-deephi', tapURI(15, 'deephi'));
try { startAmbient(); } catch (e) { console.warn('fundo', e); }
window.addEventListener('hashchange', render);
installSwipe({ onSwipe: swipeNav, surface: main() });
// marca o formulário como alterado (para perguntar antes de sair deslizando)
['input', 'change'].forEach(ev => main().addEventListener(ev, e => { const f = e.target.closest?.('form#f'); if (f) f.dataset.dirty = '1'; }));
// reavalia o bloqueio quando o app volta para a tela (ex.: virou o dia)
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
setInterval(() => { if (!document.hidden) renderChromeOnly(); }, 60_000);
function renderChromeOnly() {
  if (!S.profile) return;
  const r = route();
  if (locked() && r.name !== 'conferencia') render();
}

// quando chegam dados de outro celular, redesenha (sem atrapalhar quem está digitando)
const toggleOffline = () => $('#c-off')?.classList.toggle('hidden', navigator.onLine);
window.addEventListener('online', toggleOffline);
window.addEventListener('offline', toggleOffline);
cloud.onChange(async (st, changed) => {
  if (st.sentOffline) toast(st.sentOffline === 1 ? 'A conferência salva sem internet foi enviada.' : `${st.sentOffline} registros salvos sem internet foram enviados.`);
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
  navigator.serviceWorker.register('sw.js').then(reg => reg.update()).catch(err => console.warn('SW', err));
  // versão nova instalada: recarrega uma vez para usar o código novo (o rascunho da contagem fica guardado)
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded || ['novo', 'editar'].includes(route().name)) return;
    reloaded = true; location.reload();
  });
}

// pede ao navegador para não apagar os dados locais por falta de espaço
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

// usado pelos testes automáticos para esperar a tela terminar de desenhar
window.__app = { render, S, idle: () => rendering, cloud };
(async () => {
  if (await db.get('settings', 'profile')) cloud.startAuto();
  render();
})();
