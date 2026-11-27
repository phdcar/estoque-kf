// Service worker: guarda os arquivos do app para abrir sem internet.
const VERSION = 'kf-estoque-v0.8.0';
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/ambient.js', 'js/db.js', 'js/stock.js', 'js/illustrations.js', 'js/icons.js', 'js/lineart.js', 'js/schedule.js', 'js/cloud.js', 'js/config.js', 'js/insights.js', 'js/scanner.js',
  'js/vendor/supabase.js', 'js/vendor/591.supabase.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/maskable-512.png', 'icons/kf-logo.png',
  'fonts/jost-latin-300-normal.woff2', 'fonts/jost-latin-400-normal.woff2', 'fonts/jost-latin-500-normal.woff2',
  'fonts/jost-latin-600-normal.woff2', 'fonts/bodoni-moda-latin-500-normal.woff2',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// rede primeiro (pega atualizações), cache se estiver sem internet
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true })
      .then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});

// ---------- notificações push (etapa 3): mostra o aviso e atualiza o número no ícone ----------
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  const jobs = [self.registration.showNotification(d.title || 'Estoque KF', {
    body: d.body || 'O estoque foi alterado.',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: 'kf-estoque',
    renotify: true,
    data: { url: d.url || './#painel' },
  })];
  if (typeof d.badge === 'number' && self.navigator.setAppBadge) {
    jobs.push((d.badge > 0 ? self.navigator.setAppBadge(d.badge) : self.navigator.clearAppBadge()).catch(() => {}));
  }
  e.waitUntil(Promise.all(jobs));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) { c.navigate('./#painel').catch(() => {}); return c.focus(); }
    return self.clients.openWindow('./#painel');
  }));
});
