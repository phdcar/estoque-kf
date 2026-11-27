// Desenhos ilustrados de cada produto, usados quando o produto ainda não tem foto.
// Cada desenho é um SVG 64×64 com volume: gradientes de material (plástico, vidro, aço,
// látex, papel...), brilho especular, sombra de contato no chão e textura de fibra/papel.
// Os materiais, filtros e texturas ficam definidos uma vez na página (ILL_DEFS).

// ---------- materiais ----------
// cada material vira dois gradientes: horizontal (objetos em pé) e "-v" (objetos deitados)
const MAT = {
  white:  ['#8C877E', '#FBF9F4', '#E7E2D8', '#A39D92'],
  cotton: ['#CFC9BE', '#FFFFFF', '#F3F0EA', '#C2BBAF'],
  glass:  ['rgba(150,178,190,.75)', 'rgba(240,248,250,.92)', 'rgba(200,220,228,.55)', 'rgba(130,158,170,.8)'],
  water:  ['#6E9AB2', '#D3EAF3', '#A6C8D8', '#628BA2'],
  gold:   ['#7A6131', '#F5E5BB', '#CDB27E', '#6A5327'],
  steel:  ['#5A6169', '#F6F8FA', '#AEB5BC', '#50575F'],
  navy:   ['#0D141E', '#3A4F69', '#22324A', '#0D141E'],
  yellow: ['#946A0E', '#FFE596', '#E9BA3E', '#87600C'],
  red:    ['#7A1E19', '#F3897D', '#C8463C', '#6A1713'],
  blue:   ['#5A82A3', '#DDEDF8', '#A8C8E0', '#557A99'],
  latex:  ['#A68C5C', '#F8EED8', '#E4D2AE', '#927849'],
  nitrile:['#4D5F9E', '#C9D3F5', '#8D9EE0', '#45558F'],
  pink:   ['#8C4654', '#F8C9D0', '#DA8F9C', '#783B47'],
  teal:   ['#2C6662', '#ABE0D7', '#6FB3A8', '#245955'],
  kraft:  ['#6A4B28', '#D8AE7C', '#B08552', '#5A3F20'],
  rubber: ['#16191D', '#6E767E', '#3A4148', '#121518'],
  violet: ['#4E3778', '#CDB8F0', '#8E6FC1', '#43306A'],
};
const grad = (id, c, v) => `<linearGradient id="kf-${id}${v ? '-v' : ''}" x1="0" y1="0" x2="${v ? 0 : 1}" y2="${v ? 1 : 0}">
  <stop offset="0" stop-color="${c[0]}"/><stop offset=".3" stop-color="${c[1]}"/><stop offset=".62" stop-color="${c[2]}"/><stop offset="1" stop-color="${c[3]}"/></linearGradient>`;
const sphere = (id, a, b, c) => `<radialGradient id="kf-${id}" cx=".36" cy=".32" r=".78">
  <stop offset="0" stop-color="${a}"/><stop offset=".55" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></radialGradient>`;

export const ILL_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  ${Object.entries(MAT).map(([k, c]) => grad(k, c, false) + grad(k, c, true)).join('')}
  ${sphere('ball-white', '#FFFFFF', '#E4DFD5', '#8F897F')}${sphere('ball-blue', '#E6F2FB', '#7FA6C8', '#3F6688')}
  <linearGradient id="kf-shine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".45" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <linearGradient id="kf-shine-v" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".45" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <linearGradient id="kf-side" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".18"/><stop offset="1" stop-color="#000" stop-opacity=".42"/></linearGradient>
  <radialGradient id="kf-shadow"><stop offset="0" stop-color="#000" stop-opacity=".6"/><stop offset=".6" stop-color="#000" stop-opacity=".22"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
  <pattern id="kf-weave" width="2" height="2" patternUnits="userSpaceOnUse"><path d="M0 1h2M1 0v2" stroke="#7E776C" stroke-opacity=".38" stroke-width=".32"/></pattern>
  <filter id="kf-lift" x="-20%" y="-20%" width="140%" height="150%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="1.1"/><feOffset dx=".6" dy="1.5" result="b"/>
    <feComponentTransfer in="b" result="s"><feFuncA type="linear" slope=".55"/></feComponentTransfer>
    <feMerge><feMergeNode in="s"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="kf-grain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="2.4" numOctaves="1" seed="4" result="t"/>
    <feColorMatrix in="t" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  .5 0 0 0 -.18" result="a"/>
    <feComposite in="a" in2="SourceAlpha" operator="in" result="n"/>
    <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="n"/></feMerge></filter>
  <filter id="kf-fiber" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="3" seed="11" result="t"/>
    <feColorMatrix in="t" type="matrix" values="0 0 0 0 .35  0 0 0 0 .32  0 0 0 0 .28  .75 0 0 0 -.3" result="a"/>
    <feComposite in="a" in2="SourceAlpha" operator="in" result="n"/>
    <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="n"/></feMerge></filter>
</defs></svg>`;
// nome antigo, ainda usado pelo app
export const SKETCH_FILTER = ILL_DEFS;

// ---------- utilitários ----------
const u = (m, v) => `url(#kf-${m}${v ? '-v' : ''})`;
const NAVY_TXT = '#1B2636', GOLD_TXT = '#EBD7A6';
const fit = (s, w, max = 7) => Math.min(max, w / (Math.max(1, String(s).length) * 0.62)).toFixed(2);
const T = (s, x = 32, y = 60, size = 8, fill = 'currentColor', w = 600) => s ?
  `<text x="${x}" y="${y}" font-size="${size}" text-anchor="middle" fill="${fill}" stroke="none" font-family="Jost, sans-serif" font-weight="${w}" letter-spacing=".25">${s}</text>` : '';
// sombra de contato no chão (fica fora da sombra projetada do objeto)
const sh = (cx, cy, rx, ry = rx * 0.2) => `<ellipse data-s cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#kf-shadow)" stroke="none"/>`;
// faixa de brilho especular
const shine = (x, y, w, h, op = 0.85) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(w, h) / 2}" fill="url(#kf-shine)" opacity="${op}" stroke="none"/>`;
const shineV = (x, y, w, h, op = 0.85) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(w, h) / 2}" fill="url(#kf-shine-v)" opacity="${op}" stroke="none"/>`;
// traço metálico (instrumentos finos): base escura + reflexo claro
const metal = (d, w = 2) => `<path d="${d}" stroke="#4F565E" stroke-opacity="1" stroke-width="${w + 0.5}" fill="none"/><path d="${d}" stroke="#C9CFD5" stroke-opacity="1" stroke-width="${w}" fill="none"/><path d="${d}" stroke="#fff" stroke-opacity=".9" stroke-width="${w * 0.3}" fill="none" transform="translate(-.25 -.3)"/>`;
const NS = 'stroke="none"';

const D = {
  // frasco com válvula pump (álcool 70%, sabão enzimático)
  frasco: (l, liq = 'water') => `${sh(32, 57, 15)}
    <path d="M33 8.5h8.5a1.6 1.6 0 0 1 0 3.2H33z" fill="${u('white', 1)}"/>
    <rect x="27" y="7" width="8" height="6.5" rx="1.4" fill="${u('white')}"/>
    <rect x="30.2" y="13.5" width="3.6" height="4.5" fill="${u('steel')}"/>
    <rect x="26" y="18" width="12" height="4.5" rx="1" fill="${u('white')}"/>
    <path d="M27 19.5v2M29 19.5v2M31 19.5v2M33 19.5v2M35 19.5v2M37 19.5v2" stroke="#000" stroke-opacity=".18"/>
    <path d="M24 22.5h16l3 5V52a4 4 0 0 1-4 4H25a4 4 0 0 1-4-4V27.5z" fill="${u('white')}"/>
    <path d="M21.6 41h20.8v11a3.4 3.4 0 0 1-3.4 3.4H25a3.4 3.4 0 0 1-3.4-3.4z" fill="${u(liq)}" opacity=".6" ${NS}/>
    <path d="M21.8 41c5 1.3 15.4 1.3 20.4 0" stroke="#fff" stroke-opacity=".7"/>
    <rect x="23.6" y="28" width="16.8" height="12.5" rx="1.6" fill="${u('navy')}"/>
    <rect x="23.6" y="37.6" width="16.8" height=".9" fill="${u('gold')}" ${NS}/>
    ${T(l, 32, 35.4, fit(l, 14), GOLD_TXT)}${shine(24.6, 24.5, 2.8, 29)}`,

  // galão de 1 litro com alça (Riohex clorexidina)
  galao: l => `${sh(32, 57, 18)}
    <path d="M44 21h4.5a3.5 3.5 0 0 1 3.5 3.5v9a3.5 3.5 0 0 1-3.5 3.5H45v-3.4h3a.6.6 0 0 0 .6-.6v-8a.6.6 0 0 0-.6-.6h-4z" fill="${u('white')}"/>
    <rect x="27" y="6.5" width="10" height="7.5" rx="1.4" fill="${u('blue')}"/>
    <path d="M29 7.5v5.5M31.3 7.5v5.5M33.6 7.5v5.5M35.6 7.5v5.5" stroke="#fff" stroke-opacity=".35"/>
    <rect x="28.5" y="14" width="7" height="2.5" fill="${u('white')}"/>
    <path d="M20 16.5h24l4 7V52a4 4 0 0 1-4 4H20a4 4 0 0 1-4-4V23.5z" fill="${u('white')}"/>
    <path d="M16.6 38h30.8v14a3.4 3.4 0 0 1-3.4 3.4H20a3.4 3.4 0 0 1-3.4-3.4z" fill="${u('teal')}" opacity=".45" ${NS}/>
    <path d="M16.8 38c7 1.4 23.4 1.4 30.4 0" stroke="#fff" stroke-opacity=".7"/>
    <rect x="19" y="25" width="23" height="15" rx="1.6" fill="${u('navy')}"/>
    <path d="M19 29.5h23" stroke="${GOLD_TXT}" stroke-opacity=".7" stroke-width=".5"/>
    ${T('RIOHEX', 30.5, 28.2, 2.6, GOLD_TXT, 500)}${T(l, 30.5, 37.2, 7, GOLD_TXT)}${shine(18.6, 19, 3, 34)}`,

  // agulha hipodérmica (cor do canhão e espessura mudam com o calibre)
  agulha: (l, w = 1.4, hub = 'gold') => `
    <g transform="rotate(-35 32 30)">
      <path d="M5 25.5h13l2.2 1.5v6l-2.2 1.5H5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z" fill="${u(hub, 1)}"/>
      <path d="M8 25.6v8.8M11 25.6v8.8M14 25.6v8.8" stroke="#000" stroke-opacity=".25"/>
      ${shineV(5, 26.6, 14, 1.6, 0.7)}
      <rect x="20" y="27.4" width="5" height="5.2" rx=".7" fill="${u('steel', 1)}"/>
      <rect x="25" y="${30 - w / 2}" width="28" height="${w}" fill="${u('steel', 1)}" stroke-width=".3"/>
      <path d="M53 ${30 - w / 2}h5.5L53 ${30 + w / 2}z" fill="${u('steel', 1)}" stroke-width=".3"/>
      <path d="M26 ${30 - w / 4}h26" stroke="#fff" stroke-opacity=".9" stroke-width="${Math.max(0.3, w * 0.25)}"/>
    </g>${T(l, 44, 58, 9)}`,

  // tubete de anestésico odontológico (Xilestesin): vidro, êmbolo de borracha, tampa de alumínio
  tubete: (l, band) => `
    <g transform="rotate(-20 32 28)">
      <rect x="8" y="22" width="47" height="13" rx="2.2" fill="${u('glass', 1)}"/>
      <rect x="16.5" y="23.2" width="33.5" height="10.6" fill="${u('water', 1)}" opacity=".5" ${NS}/>
      <rect x="10" y="22.6" width="6.5" height="11.8" rx="1.2" fill="${u('rubber', 1)}"/>
      <path d="M12 23v11M14.2 23v11" stroke="#fff" stroke-opacity=".2"/>
      <rect x="24" y="22.2" width="19" height="12.6" fill="${u(band, 1)}" opacity=".92"/>
      <path d="M27 25.8h13M27 28.5h9M27 31.2h11" stroke="#fff" stroke-opacity=".55" stroke-width=".8"/>
      <rect x="50" y="21.3" width="7.5" height="14.4" rx="2" fill="${u('steel', 1)}"/>
      <path d="M52.7 21.6v13.8" stroke="#000" stroke-opacity=".25"/>
      ${shineV(9, 23.6, 47, 2.4)}
    </g>${T(l, 32, 57, 9)}`,

  // caixa amarela de perfurocortante (tipo Descarpack)
  caixa: () => `${sh(32, 56, 24, 3.2)}
    <path d="M24 17v-5.5h16V17" stroke="#7E5A0C" stroke-opacity="1" stroke-width="3" fill="none"/>
    <path d="M24 17v-5.5h16V17" stroke="#F2CD64" stroke-opacity="1" stroke-width="1.6" fill="none"/>
    <g filter="url(#kf-grain)">
      <path d="M12 24l6-8h28l6 8z" fill="${u('yellow', 1)}"/>
      <path d="M12 24h40v30H12z" fill="${u('yellow')}"/>
    </g>
    <path d="M18 16h28" stroke="#fff" stroke-opacity=".6"/>
    <rect x="12" y="24" width="40" height="4.5" fill="#7E5A0C" opacity=".45" ${NS}/>
    <path d="M32 31l10.5 17.5h-21z" fill="${NAVY_TXT}" stroke="none"/>
    <path d="M32 34.6l7.3 12h-14.6z" fill="#F7D35A" stroke="none"/>
    <path d="M32 37.8v4.6" stroke="${NAVY_TXT}" stroke-opacity="1" stroke-width="1.7"/><circle cx="32" cy="44.6" r="1" fill="${NAVY_TXT}" stroke="none"/>
    <path d="M14 51h36" stroke="#000" stroke-opacity=".2"/>${shine(13, 29, 3, 23, 0.55)}`,

  // campo descartável dobrado (não tecido branco)
  campo: () => `${sh(32, 49, 25, 4)}
    <g filter="url(#kf-fiber)">
      <path d="M8 26l24-9 24 9-24 9z" fill="${u('cotton', 1)}"/>
      <path d="M8 26l24 9v10L8 36z" fill="#E2DDD3"/>
      <path d="M32 35l24-9v10l-24 9z" fill="#BDB6AA"/>
    </g>
    <path d="M8 29.3l24 9 24-9M8 32.6l24 9 24-9" stroke="#000" stroke-opacity=".2"/>
    <path d="M8 26.6l24 9 24-9" stroke="#fff" stroke-opacity=".7"/>
    <path d="M15 26l17-6.4L49 26l-17 6.4z" stroke-dasharray="1 1.1" stroke-opacity=".35" fill="none"/>
    <path d="M20 22.4l12-4.4" stroke="#fff" stroke-opacity=".9" stroke-width="1.2"/>`,

  // cânula de microcânula com agulha guia
  canula: l => `
    <g transform="rotate(-30 32 30)">
      <path d="M4.5 25.5h12.5l1.6 1.6v5.8L17 34.5H4.5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z" fill="${u('navy', 1)}"/>
      <path d="M7.5 25.6v8.8M10.5 25.6v8.8M13.5 25.6v8.8" stroke="#fff" stroke-opacity=".18"/>
      ${shineV(4.5, 26.6, 13, 1.5, 0.5)}
      <rect x="18.6" y="27.6" width="4" height="4.8" rx=".6" fill="${u('steel', 1)}"/>
      <rect x="22.6" y="28.8" width="33" height="2.4" rx="1.2" fill="${u('steel', 1)}" stroke-width=".3"/>
      <path d="M23.5 29.4h31" stroke="#fff" stroke-opacity=".9" stroke-width=".5"/>
      <circle cx="51" cy="30" r=".6" fill="#2A2F35" stroke="none"/>
    </g>${T(l, 44, 58, 9)}`,

  // cotonete: haste plástica e pontas de algodão
  cotonete: () => `${sh(32, 52, 20, 2.5)}
    <path d="M14.5 49.5L49.5 14.5" stroke="#A9A296" stroke-opacity="1" stroke-width="2.8"/>
    <path d="M14.5 49.5L49.5 14.5" stroke="#FBF9F4" stroke-opacity="1" stroke-width="1.5"/>
    <g filter="url(#kf-fiber)">
      <ellipse cx="51.5" cy="12.5" rx="5" ry="7.8" transform="rotate(45 51.5 12.5)" fill="${u('cotton')}"/>
      <ellipse cx="12.5" cy="51.5" rx="5" ry="7.8" transform="rotate(45 12.5 51.5)" fill="${u('cotton')}"/>
    </g>
    <path d="M47 11c2-3 5-4 7-3M8 47c2-3 5-4 7-3" stroke="#fff" stroke-opacity=".9" stroke-width="1.2"/>`,

  // pacote de lenços demaquilantes com tampa e lenço saindo
  lencos: () => `${sh(32, 53, 26, 3)}
    <rect x="7" y="22" width="50" height="29" rx="9" fill="${u('white', 1)}"/>
    <rect x="8.5" y="37" width="47" height="4" fill="${u('pink', 1)}" opacity=".85" ${NS}/>
    <path d="M12 25.5c10-2.6 30-2.6 40 0" stroke="#fff" stroke-opacity=".75" stroke-width="1"/>
    <rect x="17" y="24.5" width="30" height="10.5" rx="5.2" fill="${u('gold', 1)}"/>
    <rect x="20" y="26.5" width="24" height="6.5" rx="3.2" fill="#000" opacity=".22" ${NS}/>
    <g filter="url(#kf-fiber)"><path d="M24.5 30c2-8 5-12 8.5-17.5 2 5 5 9.5 6.5 17.5z" fill="${u('cotton')}"/></g>
    <path d="M30 28c1-5 2-8 3-11" stroke="#000" stroke-opacity=".18"/>
    <path d="M12 46h40" stroke="#000" stroke-opacity=".15"/>`,

  // frasco de demaquilante bifásico com tampa flip
  flip: l => `${sh(32, 57, 13)}
    <path d="M25 8h14l2 8.5H23z" fill="${u('gold')}"/>
    <path d="M24 12.4h16" stroke="#000" stroke-opacity=".3"/><path d="M26.5 9.4h6" stroke="#fff" stroke-opacity=".6"/>
    <path d="M22 16.5h20V52a4 4 0 0 1-4 4H26a4 4 0 0 1-4-4z" fill="${u('glass')}"/>
    <rect x="22.6" y="33" width="18.8" height="11" fill="${u('water')}" opacity=".3" ${NS}/>
    <path d="M22.6 44h18.8v8a3.4 3.4 0 0 1-3.4 3.4H26a3.4 3.4 0 0 1-3.4-3.4z" fill="${u('blue')}" opacity=".8" ${NS}/>
    <path d="M22.8 44c4 1 14.4 1 18.4 0M22.8 33c4 1 14.4 1 18.4 0" stroke="#fff" stroke-opacity=".7"/>
    <rect x="24.5" y="20.5" width="15" height="11" rx="1.3" fill="${u('navy')}"/>
    ${T(l, 32, 27.8, fit(l, 13), GOLD_TXT)}${shine(23.2, 18, 2.4, 35)}`,

  // discos de algodão empilhados
  discos: () => `${sh(32, 50, 23, 4.5)}
    <g filter="url(#kf-fiber)">
      ${[46, 41, 36].map(y => `<path d="M12 ${y}v-4a20 7 0 0 1 40 0v4a20 7 0 0 1-40 0z" fill="#DAD4C9"/>`).join('')}
      <ellipse cx="32" cy="32" rx="20" ry="7" fill="${u('cotton', 1)}"/>
    </g>
    <path d="M12.4 44.5a20 7 0 0 0 39.2 0M12.4 39.5a20 7 0 0 0 39.2 0" stroke="#000" stroke-opacity=".2"/>
    ${[[24, 30], [32, 28.6], [40, 30], [20, 33], [28, 32.6], [36, 32.6], [44, 33], [32, 35.4]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".6" fill="#000" opacity=".16" ${NS}/>`).join('')}
    <path d="M20 28.3c5-1.8 12-2 18-1.2" stroke="#fff" stroke-opacity=".9" stroke-width="1.1"/>`,

  // fio de PDO (lifting) com agulha curva e garras
  fio: l => `
    ${metal('M12 30a20 20 0 0 1 34-12', 1.8)}${metal('M46 18l3-5', 1.3)}
    <path d="M12 30c2 6 6 2 9 8s6 2 9 8 6 2 9 8 5 0 8 2" stroke="#43306A" stroke-opacity="1" stroke-width="2"/>
    <path d="M12 30c2 6 6 2 9 8s6 2 9 8 6 2 9 8 5 0 8 2" stroke="#9C80D0" stroke-opacity="1" stroke-width="1.2"/>
    <path d="M17 36.5l2.4-2.6M26 44.5l2.4-2.6M35 50.5l2.4-2.6" stroke="#9C80D0" stroke-opacity="1" stroke-width=".9"/>
    <circle cx="12" cy="30" r="1.6" fill="${u('steel')}"/>${T(l, 48, 40, 9)}`,

  // flaconete plástico de 10 ml com lacre de torcer
  flaconete: (l, txt = NAVY_TXT) => `${sh(32, 58, 13)}
    <path d="M27 4.5h10V10l-2 2h-6l-2-2z" fill="${u('white')}"/>
    <path d="M29 6.5h6" stroke="#000" stroke-opacity=".2"/>
    <rect x="29" y="12" width="6" height="4.5" fill="${u('white')}"/>
    <path d="M22 16.5h20l2 6V52a4 4 0 0 1-4 4H24a4 4 0 0 1-4-4V22.5z" fill="${u('glass')}"/>
    <path d="M20.6 32h22.8v20a3.4 3.4 0 0 1-3.4 3.4H24a3.4 3.4 0 0 1-3.4-3.4z" fill="${u('water')}" opacity=".55" ${NS}/>
    <path d="M20.8 32c5 1.2 17.4 1.2 22.4 0" stroke="#fff" stroke-opacity=".75"/>
    <g filter="url(#kf-grain)"><rect x="24" y="20.5" width="16" height="10" rx="1" fill="${u('cotton')}"/></g>
    ${T(l, 32, 27.6, fit(l, 13.5), txt)}
    <path d="M37.5 36h3M38.5 40h2M37.5 44h3M38.5 48h2" stroke="${NAVY_TXT}" stroke-opacity=".55" stroke-width=".55"/>
    ${shine(21.6, 19, 2.6, 35)}`,

  // gaze estéril: compressa de trama com canto dobrado
  gaze: () => `${sh(32, 54, 25, 3)}
    <path d="M13 52.5h38M14.5 54.3h35" stroke="#000" stroke-opacity=".3"/>
    <g filter="url(#kf-fiber)"><path d="M12 15h40v23L40 50H12z" fill="${u('cotton', 1)}"/></g>
    <path d="M12 15h40v23L40 50H12z" fill="url(#kf-weave)" ${NS}/>
    <path d="M52 38L40 50l2.2-10.2z" fill="${u('cotton')}"/>
    <path d="M40 50l2.2-10.2L52 38" stroke="#000" stroke-opacity=".25"/>
    <path d="M18 15v35M46 15v23" stroke="#000" stroke-opacity=".12" stroke-width="1.4"/>
    <path d="M13.5 16.5h37" stroke="#fff" stroke-opacity=".9" stroke-width="1"/>`,

  // touca descartável sanfonada
  gorro: () => `${sh(32, 49, 25, 3)}
    <g filter="url(#kf-fiber)"><path d="M9 40c0-16 10-27 23-27s23 11 23 27z" fill="${u('blue')}"/></g>
    <path d="M20 21c3 5 5 11 5 19M32 13v27M44 21c-3 5-5 11-5 19M14 29c2 3 3 7 3 11M50 29c-2 3-3 7-3 11" stroke="#335675" stroke-opacity=".35"/>
    <path d="M16 26c3-6 8-10 14-11.5" stroke="#fff" stroke-opacity=".7" stroke-width="1.6"/>
    <path d="M8 39${'q2.4 3.4 4.8 0'.repeat(10)}v2.6${'q-2.4 3.4-4.8 0'.repeat(10)}z" fill="${u('blue', 1)}"/>`,

  // hidratante labial em bastão (Potenza)
  labial: () => `${sh(32, 58, 11)}
    <path d="M27 24.5V15.5l9-3.5v12.5z" fill="${u('pink')}"/>
    <path d="M28.5 15v9" stroke="#fff" stroke-opacity=".6" stroke-width="1"/>
    <rect x="25.5" y="24" width="13" height="6" rx=".8" fill="${u('gold')}"/>
    <rect x="24" y="30" width="16" height="26" rx="2" fill="${u('white')}"/>
    <rect x="24" y="38" width="16" height="11" fill="${u('pink')}" ${NS}/>
    <path d="M24 36h16M24 51h16" stroke="#000" stroke-opacity=".2"/>
    ${T('POTENZA', 32, 44.8, 2.3, '#5A2A33', 600)}${shine(25.4, 25, 2.2, 30)}`,

  // kit cirúrgico: bandeja inox com campo azul, tesoura e pinça
  kit: () => `${sh(32, 55, 28, 3)}
    <rect x="5" y="14" width="54" height="38" rx="5" fill="${u('steel', 1)}"/>
    <g filter="url(#kf-fiber)"><rect x="8.5" y="17.5" width="47" height="31" rx="3.2" fill="${u('blue', 1)}"/></g>
    <circle cx="16" cy="40" r="3.6" stroke="#4F565E" stroke-opacity="1" stroke-width="2.4" fill="none"/>
    <circle cx="16" cy="40" r="3.6" stroke="#D5DADF" stroke-opacity="1" stroke-width="1.6" fill="none"/>
    <circle cx="23.5" cy="44" r="3.6" stroke="#4F565E" stroke-opacity="1" stroke-width="2.4" fill="none"/>
    <circle cx="23.5" cy="44" r="3.6" stroke="#D5DADF" stroke-opacity="1" stroke-width="1.6" fill="none"/>
    ${metal('M18.6 37.4L40 20', 1.6)}${metal('M26.4 41.6L46.5 28', 1.6)}
    ${metal('M40 46.5l12-27M44.5 46.5l10-27', 1.4)}${metal('M39 47h6.5', 1.4)}
    <path d="M7 15.5h50" stroke="#fff" stroke-opacity=".8"/>`,

  // lâmina de bisturi nº 11 com recorte de encaixe
  lamina: l => `
    <path d="M8 34h26l22-16-8 22H34z" fill="${u('steel', 1)}"/>
    <path d="M34 34l22-16-3.6 9.4L36 37z" fill="#fff" opacity=".35" ${NS}/>
    <path d="M34.5 39.2l13-.2" stroke="#000" stroke-opacity=".25"/>
    <path d="M14 31h12a3 3 0 0 1 0 6H14a3 3 0 0 1 0-6z" fill="#0E151F" opacity=".5"/><path d="M14 36.4h12" stroke="#fff" stroke-opacity=".5"/>
    <path d="M9 35h24" stroke="#fff" stroke-opacity=".8" stroke-width=".5"/>${T(l, 32, 56, 10)}`,

  // luva (látex creme ou nitrílica azul), com punho enrolado
  luva: (l, mat = 'latex') => `${sh(33, 58, 15)}
    <path d="M20 54V34l-6-9a3 3 0 0 1 5-3l5 7V12a3 3 0 0 1 6 0v14V9a3 3 0 0 1 6 0v17V12a3 3 0 0 1 6 0v16-10a3 3 0 0 1 6 0v22c0 8-4 12-8 14z"
      fill="${u(mat)}"/>
    <rect x="19" y="52" width="27" height="5" rx="2.4" fill="${u(mat, 1)}"/>
    <path d="M25 13v12M31 10v14M37 13v13M43 19v10M15.5 24l4 5" stroke="#fff" stroke-opacity=".6" stroke-width="1.1"/>
    <path d="M30 27v4M36 27v4M42 29v3" stroke="#000" stroke-opacity=".18"/>
    ${T(l, 34, 47, 8, mat === 'latex' ? '#5C4722' : '#1D275A')}`,

  // máscara cirúrgica tripla com pregas e clipe nasal
  mascara: () => `${sh(32, 50, 22, 2.6)}
    <path d="M16 24c-8 0-10 13 0 15M48 24c8 0 10 13 0 15" stroke="#ECE7DD" stroke-opacity="1" stroke-width="1.4"/>
    <g filter="url(#kf-fiber)"><path d="M16 22c10-4 22-4 32 0v18c-10 6-22 6-32 0z" fill="${u('blue', 1)}"/></g>
    ${[27.5, 32.5, 37.5].map(y => `<path d="M16 ${y}c10-3 22-3 32 0" stroke="#335675" stroke-opacity=".5"/><path d="M16 ${y + 1}c10-3 22-3 32 0" stroke="#fff" stroke-opacity=".45"/>`).join('')}
    <path d="M24 21.4c5-1 11-1 16 0" stroke="#fff" stroke-opacity=".9" stroke-width="1.3"/>
    <path d="M18 22.5v17M46 22.5v17" stroke-dasharray=".8 .8" stroke-opacity=".35"/>`,

  // rolo de papel (papel grau) ou de embalagem para esterilização (rolopack)
  rolo: (l, film = false) => `${sh(34, 53, 26, 3)}
    <path d="M26 44h15l16 9H41z" fill="${film ? u('teal', 1) : '#E9E4DA'}" opacity="${film ? 0.75 : 1}"/>
    <g filter="url(#kf-grain)"><path d="M18 16h22a6 14 0 0 1 0 28H18z" fill="${u('cotton', 1)}"/></g>
    ${film ? `<path d="M18 26h25.4v8H18z" fill="${u('teal', 1)}" opacity=".7" ${NS}/><path d="M24 30h6l-1.5-1.5M24 30l4.5 0M34 30h6l-1.5-1.5" stroke="#fff" stroke-opacity=".8"/>` : ''}
    <path d="M18 18.5h21" stroke="#fff" stroke-opacity=".9" stroke-width="1.2"/>
    <ellipse cx="18" cy="30" rx="7" ry="14" fill="#F4F0E9"/>
    <ellipse cx="18" cy="30" rx="5.4" ry="11" stroke-opacity=".22" fill="none"/>
    <ellipse cx="18" cy="30" rx="4" ry="8" stroke-opacity=".22" fill="none"/>
    <ellipse cx="18" cy="30" rx="2.8" ry="5.6" fill="${u('kraft')}"/>
    <ellipse cx="18.3" cy="30" rx="1.6" ry="3.8" fill="#0E151F" opacity=".75"/>${T(l, 36, 61, 8)}`,

  // pincel aplicador de gloss
  pincel: () => `${sh(32, 55, 20, 2.2)}
    <g transform="rotate(-45 32 32)">
      <rect x="1" y="30" width="31" height="4" rx="2" fill="${u('navy', 1)}"/>
      ${shineV(3, 30.6, 28, 1.2, 0.6)}
      <rect x="32" y="29" width="9" height="6" rx="1" fill="${u('gold', 1)}"/>
      <path d="M34.5 29.2v5.6M37 29.2v5.6" stroke="#000" stroke-opacity=".2"/>
      <path d="M41 29.4C48 28.6 55 30 61 32c-6 2-13 3.4-20 2.6z" fill="${u('kraft', 1)}"/>
      <path d="M42 31c6-.6 12 0 17 1M42 33c6 .6 12 0 17-1" stroke="#000" stroke-opacity=".25" stroke-width=".4"/>
      <path d="M42 30.4c6-.5 11 .2 15 1" stroke="#fff" stroke-opacity=".55" stroke-width=".5"/>
    </g>`,

  // bisnaga de pomada
  pomada: (l, band = 'navy') => `${sh(32, 47, 26, 2.6)}
    <path d="M7 22h5v20H7z" fill="${u('steel', 1)}"/>
    <path d="M8 24.5h3M8 28h3M8 31.5h3M8 35h3M8 38.5h3" stroke="#000" stroke-opacity=".3"/>
    <path d="M12 23l30-3v24l-30-3z" fill="${u('white', 1)}"/>
    <path d="M15 26.6l24-2.4v15.6l-24-2.4z" fill="${u(band, 1)}"/>
    <rect x="42" y="24" width="4" height="16" fill="${u('white', 1)}"/>
    <rect x="46" y="25" width="10" height="14" rx="1.6" fill="${u('gold', 1)}"/>
    <path d="M48.5 25.4v13.2M51 25.4v13.2M53.5 25.4v13.2" stroke="#000" stroke-opacity=".25"/>
    ${T(l, 27, 34.4, fit(l, 21), band === 'navy' ? GOLD_TXT : '#fff')}${shineV(13, 24.2, 28, 2)}`,

  // saco branco leitoso para resíduo infectante, com símbolo
  saco: () => `${sh(32, 55, 22, 3)}
    <path d="M18 18c-6 8-8 24-6 34h40c2-10 0-26-6-34z" fill="${u('white')}"/>
    <path d="M24 18c2-4 6-4 8-2 2-2 6-2 8 2z" fill="${u('white', 1)}"/>
    <path d="M30 12.5l2 4 2-4-2-1.5z" fill="${u('white')}"/>
    <path d="M22 26c-2 8-3 16-2 24M42 26c2 8 3 16 2 24M27 20c-1 4-1 6 0 9" stroke="#000" stroke-opacity=".18" stroke-width="1"/>
    <path d="M17 28c-2 6-2.6 12-2.2 18" stroke="#fff" stroke-opacity=".9" stroke-width="1.4"/>
    <g stroke="#B33A30" stroke-opacity="1" stroke-width="1.5" fill="none">
      <circle cx="32" cy="32.5" r="4"/><circle cx="27.3" cy="40.8" r="4"/><circle cx="36.7" cy="40.8" r="4"/></g>
    <circle cx="32" cy="38" r="1.8" fill="#B33A30" stroke="none"/>`,

  // seringa descartável (com ou sem agulha)
  seringa: (l, agulha = true, hub = 'navy') => `
    <g transform="rotate(-30 32 30)">
      <rect x="2.5" y="24.5" width="2.4" height="11" rx=".8" fill="${u('white')}"/>
      <rect x="4.9" y="28.6" width="12" height="2.8" fill="${u('white', 1)}"/>
      <rect x="12.4" y="22.4" width="2.2" height="15.2" rx=".9" fill="${u('white')}"/>
      <rect x="14.6" y="25" width="28" height="10" rx="1.3" fill="${u('glass', 1)}"/>
      <rect x="20.6" y="25.6" width="21.4" height="8.8" fill="${u('water', 1)}" opacity=".5" ${NS}/>
      <rect x="17" y="25.6" width="3.6" height="8.8" fill="${u('rubber', 1)}" ${NS}/>
      <path d="M24 25v2.8M28 25v1.8M32 25v2.8M36 25v1.8M40 25v2.8" stroke="${NAVY_TXT}" stroke-opacity=".65" stroke-width=".5"/>
      ${shineV(15.6, 26.3, 26, 1.7)}
      <path d="M42.6 27h4l1.2 1.2v3.6L46.6 33h-4z" fill="${u('glass', 1)}"/>
      ${agulha ? `<rect x="47.8" y="28.2" width="3.2" height="3.6" rx=".4" fill="${u(hub, 1)}"/>
      <rect x="51" y="29.55" width="10" height=".9" fill="${u('steel', 1)}" stroke-width=".2"/>` : ''}
    </g>${T(l, 46, 58, 9)}`,

  // torneirinha de 3 vias
  torneira: () => `${sh(32, 58, 10, 1.8)}
    <rect x="7" y="29" width="19" height="6" fill="${u('glass', 1)}"/><rect x="38" y="29" width="19" height="6" fill="${u('glass', 1)}"/>
    <rect x="29" y="38" width="6" height="17" fill="${u('glass')}"/>
    <path d="M10 29v6M13 29v6M51 29v6M54 29v6M29 50h6M29 47h6" stroke="#000" stroke-opacity=".2"/>
    <rect x="4.5" y="27.5" width="4.5" height="9" rx="1" fill="${u('blue', 1)}"/>
    <rect x="55" y="27.5" width="4.5" height="9" rx="1" fill="${u('blue', 1)}"/>
    <rect x="27.5" y="53.5" width="9" height="4.5" rx="1" fill="${u('blue')}"/>
    <circle cx="32" cy="32" r="8" fill="url(#kf-ball-white)"/>
    <path d="M29.6 32V11a2.4 2.4 0 0 1 4.8 0v21z" fill="${u('blue')}"/>
    <path d="M22 9.5h20a2.2 2.2 0 0 1 0 4.4H22a2.2 2.2 0 0 1 0-4.4z" fill="${u('blue', 1)}"/>
    <circle cx="32" cy="32" r="4.2" fill="url(#kf-ball-blue)"/>
    ${shineV(23, 10, 18, 1.4, 0.7)}`,

  // frasco-ampola de vidro com lacre de alumínio e tampa flip-off
  vial: (l, cap = 'gold', pow = false) => `${sh(32, 58, 13)}
    <rect x="23" y="6.5" width="18" height="5.5" rx="1.4" fill="${u(cap)}"/>
    <rect x="24" y="12" width="16" height="5.5" rx=".8" fill="${u('steel')}"/>
    <path d="M24 14.8h16" stroke="#000" stroke-opacity=".2"/>
    <path d="M26 17.5h12V20l4 4V52a4 4 0 0 1-4 4H26a4 4 0 0 1-4-4V24l4-4z" fill="${u('glass')}"/>
    ${pow ? `<g filter="url(#kf-fiber)"><path d="M22.6 46h18.8v6a3.4 3.4 0 0 1-3.4 3.4H26a3.4 3.4 0 0 1-3.4-3.4z" fill="${u('cotton')}"/></g>`
          : `<path d="M22.6 40h18.8v12a3.4 3.4 0 0 1-3.4 3.4H26a3.4 3.4 0 0 1-3.4-3.4z" fill="${u('cotton')}" opacity=".85" ${NS}/>`}
    <g filter="url(#kf-grain)"><rect x="23.4" y="26.5" width="17.2" height="11.5" rx="1" fill="${u('cotton')}"/></g>
    <rect x="23.4" y="26.5" width="17.2" height="2.2" fill="${u(cap)}" ${NS}/>
    ${T(l, 32, 35.4, fit(l, 15), NAVY_TXT)}${shine(23.2, 24, 2.3, 29)}`,

  // ampola de vidro com anel de quebra
  ampola: (l, ring = 'red') => `${sh(32, 58, 11)}
    <path d="M28 6h8v6l-2 4 2 4v4l4 4v24a4 4 0 0 1-4 4h-8a4 4 0 0 1-4-4V28l4-4v-4l2-4-2-4z" fill="${u('glass')}"/>
    <path d="M28.6 7h6.8v4h-6.8z" fill="${u('water')}" opacity=".45" ${NS}/>
    <path d="M24.6 31h14.8v21a3.4 3.4 0 0 1-3.4 3.4h-8a3.4 3.4 0 0 1-3.4-3.4z" fill="${u('water')}" opacity=".5" ${NS}/>
    <path d="M24.8 31c3.4 1 11 1 14.4 0" stroke="#fff" stroke-opacity=".7"/>
    <path d="M28.4 16.6h7.2" stroke="${MAT[ring][2]}" stroke-opacity="1" stroke-width="1.8"/>
    <g filter="url(#kf-grain)"><rect x="24.6" y="34" width="14.8" height="10" fill="${u('cotton')}"/></g>
    ${T(l, 32, 40.8, fit(l, 13), NAVY_TXT)}${shine(25.4, 29, 2.1, 25)}${shine(29, 6.5, 1.4, 5)}`,

  // cartela blíster de comprimidos (alumínio)
  blister: l => `${sh(32, 56, 22, 2.5)}
    <g filter="url(#kf-grain)"><rect x="12" y="8" width="40" height="46" rx="4" fill="${u('steel')}"/></g>
    <path d="M32 10v42M14 20.5h36M14 29.5h36M14 38.5h36" stroke-dasharray=".8 1" stroke-opacity=".35"/>
    ${[0, 1, 2, 3].map(r => [0, 1].map(c => {
      const x = 24 + c * 16, y = 16 + r * 9;
      return `<ellipse cx="${x}" cy="${y}" rx="5.6" ry="3.6" fill="${u('glass', 1)}"/><ellipse cx="${x}" cy="${y}" rx="4.4" ry="2.6" fill="url(#kf-ball-white)" stroke-opacity=".3"/><path d="M${x - 2.6} ${y - 1.4}h3" stroke="#fff" stroke-opacity=".95" stroke-width=".7"/>`;
    }).join('')).join('')}
    <rect x="13.5" y="48" width="37" height="4.6" rx="1" fill="${u('navy', 1)}" stroke="none"/>
    ${T(l, 32, 51.6, fit(l, 30, 3.8), GOLD_TXT)}`,

  // caixa de medicamento em perspectiva
  remedio: l => `${sh(31, 56, 25, 3)}
    <g filter="url(#kf-grain)">
      <path d="M10 22l14-8h30l-14 8z" fill="#FAF7F1"/>
      <path d="M10 22h30v32H10z" fill="${u('white')}"/>
      <path d="M40 22l14-8v32l-14 8z" fill="#E4DFD5"/>
    </g>
    <path d="M40 22l14-8v32l-14 8z" fill="url(#kf-side)" ${NS}/>
    <path d="M10 40.5h30v5H10z" fill="${u('gold', 1)}" ${NS}/><path d="M40 40.5l14-8v5l-14 8z" fill="#8C7442" ${NS}/>
    <path d="M22 25h6v4h4v5h-4v4h-6v-4h-4v-5h4z" fill="${u('red')}"/>
    <path d="M11 22.6l13-7.4h29" stroke="#fff" stroke-opacity=".9"/>
    ${T(l, 25, 51.6, fit(l, 26), NAVY_TXT)}`,

  // genérico: caixa com a inicial
  generico: l => `${sh(31, 56, 25, 3)}
    <g filter="url(#kf-grain)">
      <path d="M10 22l14-8h30l-14 8z" fill="#FAF7F1"/>
      <path d="M10 22h30v32H10z" fill="${u('white')}"/>
      <path d="M40 22l14-8v32l-14 8z" fill="#E4DFD5"/>
    </g>
    <path d="M40 22l14-8v32l-14 8z" fill="url(#kf-side)" ${NS}/>
    <path d="M10 47h30v4H10z" fill="${u('gold', 1)}" ${NS}/><path d="M40 47l14-8v4l-14 8z" fill="#8C7442" ${NS}/>
    <path d="M11 22.6l13-7.4h29" stroke="#fff" stroke-opacity=".9"/>
    ${T(l, 25, 41, 14, NAVY_TXT, 500)}`,
};

// cor do canhão da agulha pelo calibre (padrão de mercado)
const hubFor = g => ({ 18: 'pink', 21: 'teal', 22: 'navy', 23: 'blue', 25: 'blue', 26: 'kraft', 27: 'steel', 30: 'yellow', 31: 'yellow', 32: 'gold' }[g] || 'gold');

// regras: a primeira que bater com o nome do produto vence
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const RULES = [
  [/SABAO|ENZIMATICO/, () => D.frasco('Enzim.', 'teal')],
  [/ALCOOL/, () => D.frasco('70%')],
  [/CLOREXIDINA/, () => D.galao('2%')],
  [/SERINGA.*?(\d+\s*ML)/, m => D.seringa(m[1].replace(/\s*ML/i, ' ml'), /AGULHA/.test(m.input), 'navy')],
  [/SERINGA.*?(\d+)\s*UI?\b/, m => D.seringa(`${m[1]} UI`, true, 'yellow')],
  [/SERINGA/, () => D.seringa('')],
  [/CANULA/, () => D.canula('22G')],
  [/AGULHA\s*(\d+)G/, m => D.agulha(`${m[1]}G`, Number(m[1]) <= 22 ? 2.6 : 1.3, hubFor(Number(m[1])))],
  [/XILESTESIN.*(S\/|\bSEM)\s*VASO/, () => D.tubete('Sem vaso', 'blue')],
  [/XILESTESIN|ANESTESICO/, () => D.tubete('Com vaso', 'red')],
  [/PERFURO/, () => D.caixa()],
  [/CAMPO/, () => D.campo()],
  [/COTONETE/, () => D.cotonete()],
  [/DEMAQUILANTE.*LENC/, () => D.lencos()],
  [/DEMAQUILANTE/, () => D.flip('Demaq.')],
  [/ALGODAO/, () => D.discos()],
  [/\bFIO\b/, () => D.fio('2.0')],
  [/FLACONETE.*AGUA/, () => D.flaconete('Água', '#2F5F80')],
  [/FLACONETE|SORO/, () => D.flaconete('Soro')],
  [/GAZE/, () => D.gaze()],
  [/GORRO|TOUCA/, () => D.gorro()],
  [/LABIAL/, () => D.labial()],
  [/\bKIT\b/, () => D.kit()],
  [/LAMINA|BISTURI/, () => D.lamina('Nº 11')],
  [/LUVA.*?(\d+[.,]\d)/, m => D.luva(m[1].replace('.', ','), 'latex')],
  [/LUVA\s*(\w+)/, m => D.luva(m[1], 'nitrile')],
  [/MASCARA/, () => D.mascara()],
  [/PAPEL GRAU/, () => D.rolo('5 cm')],
  [/ROLOPACK/, () => D.rolo('', true)],
  [/PINCEL/, () => D.pincel()],
  [/POMADA DIPROGENTA/, () => D.pomada('Diprogenta', 'red')],
  [/POMADA/, () => D.pomada('Anest.')],
  [/SACO|LIXO/, () => D.saco()],
  [/TORNEIRINHA/, () => D.torneira()],
  [/TRANEXAMICO/, () => D.ampola('Tranex.', 'teal')],
  [/DIPIRONA/, () => D.ampola('1 g', 'blue')],
  [/DEXAMETASONA/, () => D.ampola('Dexa', 'red')],
  [/HIALURONIDASE/, () => D.vial('Hial.', 'teal', true)],
  [/DIPROSPAN/, () => D.vial('Diprospan', 'gold')],
  [/TYLEX/, () => D.blister('Tylex')],
  [/DEOSIL/, () => D.remedio('Deosil')],
];

export function illustrationFor(name) {
  const n = norm(name);
  let body = null;
  for (const [re, fn] of RULES) {
    const m = n.match(re);
    if (m) { body = fn(m); break; }
  }
  if (!body) body = D.generico((n.trim()[0] || '?'));
  // a sombra no chão fica fora da sombra projetada do objeto
  const ground = (body.match(/<ellipse data-s[^>]*\/>/g) || []).join('');
  const shapes = body.replace(/<ellipse data-s[^>]*\/>/g, '');
  return `<svg class="ill" viewBox="0 0 64 64" role="img" aria-hidden="true" fill="none" stroke="#0A0F16" stroke-opacity=".45"
    stroke-width=".55" stroke-linecap="round" stroke-linejoin="round">${ground}<g filter="url(#kf-lift)">${shapes}</g></svg>`;
}
