// Fundo vivo no padrão do Painel KF: céu que muda com a hora do dia, estrelas à noite,
// tapeçaria de pirâmides (guilhochê) com um reflexo dourado que passa devagar.
// Feito para celular: as estrelas piscam a ~12 quadros por segundo e param quando o app sai da tela.

export function tapURI(c, mode) {
  const g = c >= 20 ? 2 : 1.6, m = c / 2, a = g, b = c - g;
  const tri = (pts, fill) => `<polygon points="${pts}" fill="${fill}"/>`;
  const T = `${a},${a} ${b},${a} ${m},${m}`, L = `${a},${a} ${a},${b} ${m},${m}`;
  const R = `${b},${a} ${b},${b} ${m},${m}`, B = `${a},${b} ${b},${b} ${m},${m}`;
  let p;
  if (mode === 'base') p = `<rect width="${c}" height="${c}" fill="rgba(0,0,0,.42)"/>` +
    tri(T, 'rgba(255,255,255,.075)') + tri(L, 'rgba(255,255,255,.035)') + tri(R, 'rgba(0,0,0,.14)') + tri(B, 'rgba(0,0,0,.24)');
  else if (mode === 'deep') p = `<rect width="${c}" height="${c}" fill="rgba(4,10,24,.75)"/>` +
    tri(T, 'rgba(170,200,255,.22)') + tri(L, 'rgba(140,170,230,.12)') + tri(R, 'rgba(0,6,20,.30)') + tri(B, 'rgba(0,4,16,.48)');
  else if (mode === 'deephi') p = tri(T, 'rgba(235,242,255,.55)') + tri(L, 'rgba(220,232,255,.25)');
  else p = tri(T, 'rgba(240,226,190,.30)') + tri(L, 'rgba(240,226,190,.12)');
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${c}" height="${c}">${p}</svg>`)}")`;
}

// cores do céu em cada momento do dia (mesma paleta do Painel KF)
const P = {
  noite:     { top: [14, 21, 32], bot: [19, 28, 41], hor: [70, 92, 140, .10], sun: [0, 0, 0, 0], star: 1 },
  amanhecer: { top: [22, 32, 58], bot: [74, 54, 72], hor: [238, 160, 120, .40], sun: [255, 200, 150, .26], star: .35 },
  manha:     { top: [24, 38, 60], bot: [36, 54, 80], hor: [230, 200, 160, .10], sun: [255, 232, 190, .22], star: 0 },
  meiodia:   { top: [28, 45, 70], bot: [34, 54, 80], hor: [220, 224, 230, .06], sun: [255, 244, 220, .30], star: 0 },
  tarde:     { top: [26, 40, 64], bot: [46, 52, 70], hor: [240, 200, 150, .18], sun: [250, 214, 160, .24], star: 0 },
  por:       { top: [26, 30, 54], bot: [82, 48, 64], hor: [235, 135, 95, .45], sun: [250, 160, 110, .34], star: .25 },
};
export const PERIOD_NAME = { noite: 'Noite', amanhecer: 'Nascer do sol', manha: 'Manhã', meiodia: 'Meio-dia', tarde: 'Tarde', por: 'Pôr do sol' };
const SR = 5 * 60 + 20, SS = 17 * 60 + 40;   // nascer e pôr do sol médios na Bahia
const KEYS = [[0, 'noite'], [SR - 70, 'noite'], [SR - 10, 'amanhecer'], [SR + 70, 'manha'], [660, 'meiodia'], [810, 'meiodia'],
  [SS - 110, 'tarde'], [SS - 15, 'por'], [SS + 45, 'noite'], [1440, 'noite']];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const rgb = (c, al) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${al ?? c[3] ?? 1})`;

export function skyState(d = new Date()) {
  const m = d.getHours() * 60 + d.getMinutes();
  let i = 0; while (i < KEYS.length - 2 && m >= KEYS[i + 1][0]) i++;
  const [ma, ka] = KEYS[i], [mb, kb] = KEYS[i + 1];
  const t = mb > ma ? Math.min(1, Math.max(0, (m - ma) / (mb - ma))) : 0;
  const A = P[ka], B = P[kb];
  return { top: mix(A.top, B.top, t), bot: mix(A.bot, B.bot, t), hor: mix(A.hor, B.hor, t), sun: mix(A.sun, B.sun, t),
    star: A.star + (B.star - A.star) * t, name: t < .85 ? ka : kb, minute: m };
}

export function startAmbient(root = document.getElementById('bg')) {
  if (!root) return;
  root.querySelector('.tap-base').style.backgroundImage = tapURI(26, 'base');
  root.querySelector('.tap-shine .shP').style.backgroundImage = tapURI(26, 'hi');
  const cv = root.querySelector('canvas'), cx = cv.getContext('2d');
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0, H = 0, dpr = 1, stars = [], st = skyState(), sky = null, last = 0, raf = 0;

  function size() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    let seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    stars = Array.from({ length: Math.round(W * H / 5200) }, () =>
      ({ x: rnd() * W, y: rnd() * H * .8, r: .35 + rnd() * 1.05, p: rnd() * 6.28, s: .5 + rnd() * 1.4 }));
    paintSky();
  }
  // o céu (gradiente + luz do horizonte + sol) é pintado uma vez num canvas fora da tela
  function paintSky() {
    sky = document.createElement('canvas'); sky.width = cv.width; sky.height = cv.height;
    const c = sky.getContext('2d'); c.scale(dpr, dpr);
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, rgb(st.top)); g.addColorStop(1, rgb(st.bot));
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    const h = c.createRadialGradient(W * .5, H * 1.05, 0, W * .5, H * 1.05, Math.max(W, H) * .9);
    h.addColorStop(0, rgb(st.hor)); h.addColorStop(1, rgb(st.hor, 0)); c.fillStyle = h; c.fillRect(0, 0, W, H);
    if (st.sun[3] > .01) {
      const pos = Math.min(1, Math.max(0, (st.minute - SR) / (SS - SR)));
      const sx = W * (.15 + .7 * pos), sy = H * (.62 - .5 * Math.sin(pos * Math.PI));
      const s = c.createRadialGradient(sx, sy, 0, sx, sy, Math.max(W, H) * .55);
      s.addColorStop(0, rgb(st.sun)); s.addColorStop(1, rgb(st.sun, 0)); c.fillStyle = s; c.fillRect(0, 0, W, H);
    }
    document.documentElement.dataset.period = st.name;
  }
  function frame(t) {
    raf = 0;
    if (t - last > 80 || !last) {
      last = t;
      cx.setTransform(1, 0, 0, 1, 0, 0); cx.drawImage(sky, 0, 0); cx.scale(dpr, dpr);
      if (st.star > .02) for (const s of stars) {
        const a = st.star * (.35 + .45 * (calm ? .7 : (.5 + .5 * Math.sin(s.p + t / 1000 * s.s))));
        cx.fillStyle = `rgba(243,239,231,${a.toFixed(3)})`; cx.beginPath(); cx.arc(s.x, s.y, s.r, 0, 6.283); cx.fill();
      }
    }
    if (!calm && st.star > .02 && !document.hidden) raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
  size(); kick();
  addEventListener('resize', () => { size(); last = 0; kick(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { last = 0; kick(); } });
  setInterval(() => { const n = skyState(); if (n.name !== st.name || Math.abs(n.minute - st.minute) >= 10) { st = n; paintSky(); last = 0; kick(); } }, 60000);
}
