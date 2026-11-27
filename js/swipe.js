// Deslizar o dedo para os lados troca de tela, em qualquer tela do app.
// Esquerda (dedo vai para a esquerda) = próxima aba; direita = aba anterior ou "voltar".
// Não atrapalha: rolagem vertical, campos de digitação, listas que rolam de lado (filtros),
// leitor de código de barras, janelas abertas por cima e os gestos do próprio celular nas bordas.

const MIN_DX = 60;        // distância mínima (px) para contar como deslizar
const RATIO = 1.4;        // precisa ser bem mais horizontal do que vertical
const MAX_MS = 900;       // gesto rápido, não um arrastar demorado
const EDGE = 22;          // no navegador, perto da borda o gesto é do sistema (voltar do Safari/Chrome)

const SKIP = 'select, input[type=range], [contenteditable], video, canvas, .chips, .scanner, .overlay, [data-noswipe]';
// campo de texto só bloqueia quando está sendo digitado (o dedo move o cursor/seleciona o texto);
// passar o dedo por cima de um campo parado, numa tela cheia de campos, ainda troca de tela
const TYPING = 'input, textarea';

function scrollsSideways(el) {
  for (; el && el !== document.body; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 2) {
      const ox = getComputedStyle(el).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
  }
  return false;
}

// no app instalado na tela de início não há gesto de voltar do navegador, então a borda também vale
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export function blocked(target, x, width, edgeFree = standalone()) {
  if (!edgeFree && (x < EDGE || x > width - EDGE)) return true;
  if (document.querySelector('.overlay, .scanner')) return true;
  if (target?.closest?.(SKIP)) return true;
  const field = target?.closest?.(TYPING);
  if (field && field === document.activeElement) return true;
  if (scrollsSideways(target)) return true;
  return false;
}

// decide se o movimento foi um deslizar: 'left', 'right' ou null
export function classify(dx, dy, ms) {
  if (ms > MAX_MS) return null;
  if (Math.abs(dx) < MIN_DX) return null;
  if (Math.abs(dx) < RATIO * Math.abs(dy)) return null;
  return dx < 0 ? 'left' : 'right';
}

export function installSwipe({ onSwipe, canSwipe = () => true, surface }) {
  let s = null;
  const reset = () => {
    if (surface) { surface.style.transform = ''; surface.style.opacity = ''; surface.style.transition = ''; }
  };
  document.addEventListener('touchstart', e => {
    s = null;
    if (e.touches.length !== 1 || !canSwipe()) return;
    const t = e.touches[0];
    if (blocked(e.target, t.clientX, window.innerWidth)) return;
    s = { x: t.clientX, y: t.clientY, t: Date.now(), horiz: null };
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!s) return;
    if (e.touches.length !== 1) { s = null; reset(); return; }
    const t = e.touches[0];
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (s.horiz === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) s.horiz = Math.abs(dx) > Math.abs(dy);
    // a tela acompanha o dedo um pouco, para mostrar que o gesto foi entendido
    if (s.horiz && surface) {
      surface.style.transition = 'none';
      surface.style.transform = `translateX(${dx * 0.25}px)`;
      surface.style.opacity = String(Math.max(0.6, 1 - Math.abs(dx) / 900));
    }
  }, { passive: true });

  const end = e => {
    if (!s) return;
    const t = e.changedTouches[0];
    const start = s; s = null;
    if (surface) { surface.style.transition = 'transform .2s ease, opacity .2s ease'; surface.style.transform = ''; surface.style.opacity = ''; setTimeout(reset, 220); }
    if (e.type === 'touchcancel' || !start.horiz) return;
    if (window.getSelection && String(window.getSelection()).length) return;
    const dir = classify(t.clientX - start.x, t.clientY - start.y, Date.now() - start.t);
    if (dir) onSwipe(dir);
  };
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', end, { passive: true });
}
