// Desenhos esquemáticos (traço de croqui) de cada produto, usados quando o produto ainda não tem foto.
// Cada desenho é um SVG 64×64 feito de traços; o filtro "rabisco" dá o tremido de desenho à mão.

const A = 'var(--ill-accent, #CDB27E)';            // champanhe KF (preenchimentos leves)
const fit = (s, w, max = 7) => Math.min(max, w / (Math.max(1, String(s).length) * 0.62)).toFixed(2);
const T = (s, x = 32, y = 60, size = 8) =>
  `<text x="${x}" y="${y}" font-size="${size}" text-anchor="middle" fill="currentColor" stroke="none" font-family="Jost, sans-serif" font-weight="600" letter-spacing=".3">${s}</text>`;

const D = {
  // frasco com válvula (álcool)
  frasco: l => `
    <path d="M27 14h10v7H27z"/><path d="M32 14V8h8"/><path d="M38 8v3"/>
    <path d="M24 21h16l3 6v25a4 4 0 0 1-4 4H25a4 4 0 0 1-4-4V27z"/>
    <path d="M22 40h20v15H22z" fill="${A}" fill-opacity=".35" stroke="none"/>
    <rect x="24" y="30" width="16" height="11" rx="1.5"/>${T(l, 32, 38.5, fit(l, 14))}`,
  // galão de 1 litro com alça (clorexidina)
  galao: l => `
    <path d="M28 8h8v6h-8z"/><path d="M20 14h24l4 8v30a4 4 0 0 1-4 4H20a4 4 0 0 1-4-4V22z"/>
    <path d="M44 20h5a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-3"/>
    <path d="M17 38h30v17H17z" fill="${A}" fill-opacity=".35" stroke="none"/>
    <rect x="20" y="25" width="22" height="12" rx="1.5"/>${T(l, 31, 34, fit(l, 19, 7.5))}`,
  // agulha (espessura muda com o calibre)
  agulha: (l, w = 1.4) => `
    <g transform="rotate(-35 32 30)">
      <path d="M6 25h13v10H6z" fill="${A}" fill-opacity=".45"/>
      <path d="M9 25v10M12 25v10M15 25v10"/><path d="M19 27h5v6h-5z"/>
      <path d="M24 30h30" stroke-width="${w}"/><path d="M54 30l4-${w}" stroke-width="${w}"/>
    </g>${T(l, 44, 58, 9)}`,
  // tubete de anestésico
  tubete: l => `
    <g transform="rotate(-20 32 28)">
      <rect x="8" y="22" width="48" height="13" rx="6"/>
      <path d="M17 24h33v9H17z" fill="${A}" fill-opacity=".4" stroke="none"/>
      <rect x="11" y="23.5" width="6" height="10" rx="1" fill="currentColor"/>
      <rect x="50" y="23" width="6" height="11" rx="1.5"/>
      <path d="M24 26v5M30 26v5M36 26v5"/>
    </g>${T(l, 32, 57, 9)}`,
  // caixa de perfurocortante
  caixa: () => `
    <path d="M12 24h40v30H12z"/><path d="M12 24l6-8h28l6 8"/>
    <path d="M26 20h12"/><path d="M24 12h16" /><path d="M24 12v4M40 12v4"/>
    <path d="M32 31l9 15H23z" fill="${A}" fill-opacity=".5"/><path d="M32 36v5M32 43.5v.5"/>`,
  // campo descartável dobrado
  campo: () => `
    <path d="M10 22l30-8 14 10-30 8z"/><path d="M10 22v8l14 10v-8"/><path d="M24 40l30-8v-8"/>
    <path d="M10 30v8l14 10 30-8v-8"/><path d="M16 23l24-6M20 26l24-6" stroke-opacity=".45"/>`,
  // cânula com agulha
  canula: l => `
    <g transform="rotate(-30 32 30)">
      <path d="M6 26h11v8H6z" fill="${A}" fill-opacity=".45"/><path d="M17 28h4v4h-4z"/>
      <path d="M21 29h34M21 31h34"/><path d="M55 29a1 1 0 0 1 0 2"/><path d="M46 29v-1.5"/>
    </g>${T(l, 44, 58, 9)}`,
  // cotonete
  cotonete: () => `
    <path d="M14 50L50 14" stroke-width="2.2"/>
    <ellipse cx="51.5" cy="12.5" rx="5" ry="7.5" transform="rotate(45 51.5 12.5)" fill="${A}" fill-opacity=".35"/>
    <ellipse cx="12.5" cy="51.5" rx="5" ry="7.5" transform="rotate(45 12.5 51.5)" fill="${A}" fill-opacity=".35"/>
    <path d="M49 9l4 4M48 13l3 3M10 49l4 4M9 53l3 3" stroke-opacity=".5"/>`,
  // pacote de lenços
  lencos: () => `
    <rect x="8" y="22" width="48" height="28" rx="7"/>
    <ellipse cx="32" cy="30" rx="12" ry="4" fill="${A}" fill-opacity=".35"/>
    <path d="M24 30c3-9 6-12 10-16 2 4 5 8 6 16"/><path d="M14 44h36" stroke-opacity=".45"/>`,
  // frasco com tampa flip (demaquilante líquido)
  flip: l => `
    <path d="M26 8h12l2 8H24z"/><path d="M27 8h6" stroke-opacity=".5"/>
    <path d="M22 16h20v36a4 4 0 0 1-4 4H26a4 4 0 0 1-4-4z"/>
    <path d="M23 38h18v16H23z" fill="${A}" fill-opacity=".35" stroke="none"/>
    <path d="M25 24h14v10H25z"/>${T(l, 32, 31.5, fit(l, 12.5))}`,
  // discos de algodão empilhados
  discos: () => `
    <ellipse cx="32" cy="44" rx="20" ry="7"/><path d="M12 44v-5M52 44v-5"/>
    <ellipse cx="32" cy="39" rx="20" ry="7"/><path d="M12 39v-5M52 39v-5"/>
    <ellipse cx="32" cy="34" rx="20" ry="7" fill="${A}" fill-opacity=".3"/>
    <path d="M20 33c4 2 8 2 12 0s8-2 12 0" stroke-opacity=".45"/>`,
  // fio com agulha curva (lifting)
  fio: l => `
    <path d="M12 30a20 20 0 0 1 34-12" stroke-width="2"/><path d="M46 18l3-5"/>
    <path d="M12 30c2 6 6 2 9 8s6 2 9 8 6 2 9 8 5 0 8 2"/>
    <path d="M18 36l2-3M27 44l2-3M36 50l2-3" stroke-opacity=".6"/>${T(l, 48, 40, 9)}`,
  // flaconete plástico de 10 ml
  flaconete: l => `
    <path d="M27 6h10v6H27z"/><path d="M29 12h6v4h-6z"/>
    <path d="M22 16h20l2 6v30a4 4 0 0 1-4 4H24a4 4 0 0 1-4-4V22z"/>
    <path d="M21 34h22v20H21z" fill="${A}" fill-opacity=".35" stroke="none"/>
    <path d="M25 24h14v9H25z"/>${T(l, 32, 31, fit(l, 12.5))}<path d="M26 42h12M26 47h8" stroke-opacity=".5"/>`,
  // gaze dobrada
  gaze: () => `
    <path d="M12 16h40v34H12z"/><path d="M12 16l8 8h40" stroke-opacity="0"/>
    <path d="M20 16v34M28 16v34M36 16v34M44 16v34M12 24h40M12 32h40M12 40h40" stroke-opacity=".4"/>
    <path d="M52 16v34l-8 6H6l6-6" fill="${A}" fill-opacity=".25"/>`,
  // gorro descartável
  gorro: () => `
    <path d="M10 40c0-16 10-26 22-26s22 10 22 26"/>
    <path d="M8 40c4 4 8-2 12 2s8-2 12 2 8-2 12 2 8-2 12 0"/>
    <path d="M10 40c0-16 10-26 22-26s22 10 22 26z" fill="${A}" fill-opacity=".25" stroke="none"/>
    <path d="M20 22c4 4 6 10 6 18M32 14v26M44 22c-4 4-6 10-6 18" stroke-opacity=".4"/>`,
  // hidratante labial
  labial: () => `
    <rect x="24" y="30" width="16" height="26" rx="2" fill="${A}" fill-opacity=".35"/>
    <path d="M24 36h16"/><path d="M26 30v-8h12v8"/><path d="M26 22l3-10h6l3 10"/>
    <path d="M30 44h4" stroke-opacity=".5"/>`,
  // kit cirúrgico (bandeja com tesoura e pinça)
  kit: () => `
    <rect x="6" y="14" width="52" height="38" rx="5"/>
    <circle cx="16" cy="40" r="4"/><circle cx="24" cy="44" r="4"/>
    <path d="M19 37l20-17M27 41l22-12"/>
    <path d="M40 46l12-26M44 46l10-26" fill="none"/><path d="M38 48h18" stroke-opacity=".45"/>`,
  // lâmina de bisturi nº 11
  lamina: l => `
    <path d="M8 34h26l22-16-8 22H34z" fill="${A}" fill-opacity=".35"/>
    <path d="M14 31h12a3 3 0 0 1 0 6H14a3 3 0 0 1 0-6z"/>${T(l, 32, 56, 10)}`,
  // luva
  luva: l => `
    <path d="M20 56V34l-6-9a3 3 0 0 1 5-3l5 7V12a3 3 0 0 1 6 0v14V9a3 3 0 0 1 6 0v17V12a3 3 0 0 1 6 0v16-10a3 3 0 0 1 6 0v22c0 8-4 12-8 14v2z"
      fill="${A}" fill-opacity=".25"/>${T(l, 34, 50, 8)}`,
  // máscara
  mascara: () => `
    <path d="M16 22c10-4 22-4 32 0v18c-10 6-22 6-32 0z" fill="${A}" fill-opacity=".25"/>
    <path d="M16 28c10-3 22-3 32 0M16 34c10-3 22-3 32 0" stroke-opacity=".5"/>
    <path d="M16 24c-8 0-10 12 0 14M48 24c8 0 10 12 0 14"/>`,
  // rolo (papel grau / rolopack)
  rolo: l => `
    <ellipse cx="18" cy="30" rx="8" ry="14"/><ellipse cx="18" cy="30" rx="3" ry="5"/>
    <path d="M18 16h22M18 44h10"/><path d="M40 16c6 0 6 28 0 28H28l26 10"/>
    <path d="M28 44l26 10V22" fill="${A}" fill-opacity=".25"/>${T(l, 36, 61, 8)}`,
  // pincel
  pincel: () => `
    <path d="M10 54l20-20" stroke-width="4"/><path d="M30 34l6-6"/>
    <path d="M28 30l6 6 4-4-6-6z" fill="${A}" fill-opacity=".5"/>
    <path d="M36 26c4-6 10-12 18-16-4 8-10 14-16 18"/>`,
  // bisnaga de pomada
  pomada: l => `
    <path d="M8 22h4v20H8z"/><path d="M12 24l30-4v24l-30-4z" fill="${A}" fill-opacity=".25"/>
    <path d="M42 22h6v20h-6z"/><path d="M48 26h6v12h-6z"/>
    <path d="M9 25h2M9 29h2M9 33h2M9 37h2" stroke-opacity=".5"/>${T(l, 27, 35, fit(l, 26))}`,
  // saco de lixo contaminado
  saco: () => `
    <path d="M18 18c-6 8-8 24-6 34h40c2-10 0-26-6-34z" fill="${A}" fill-opacity=".2"/>
    <path d="M24 18c2-4 6-4 8-2 2-2 6-2 8 2"/><path d="M30 12l2 4 2-4"/>
    <circle cx="32" cy="36" r="2.5"/><circle cx="27" cy="42" r="4"/><circle cx="37" cy="42" r="4"/><circle cx="32" cy="32" r="4"/>`,
  // seringa
  seringa: (l, agulha = true) => `
    <g transform="rotate(-30 32 30)">
      <path d="M4 27h6M7 27v6M4 33h6"/><path d="M7 30h7" stroke-width="2"/>
      <rect x="14" y="25" width="28" height="10" rx="1.5"/>
      <path d="M15 26h12v8H15z" fill="${A}" fill-opacity=".45" stroke="none"/>
      <path d="M12 23v14M20 25v3M25 25v3M30 25v3M35 25v3"/>
      <path d="M42 28h4v4h-4z"/>${agulha ? '<path d="M46 30h14"/>' : ''}
    </g>${T(l, 46, 58, 9)}`,
  // torneirinha de 3 vias
  torneira: () => `
    <circle cx="32" cy="32" r="7" fill="${A}" fill-opacity=".35"/>
    <path d="M8 29h17M8 35h17M39 29h17M39 35h17M29 39v17M35 39v17"/>
    <path d="M32 25V10"/><path d="M26 10h12" stroke-width="3"/>`,
  // frasco-ampola (vidro com tampa)
  vial: l => `
    <rect x="22" y="8" width="20" height="7" rx="1.5" fill="${A}" fill-opacity=".5"/>
    <path d="M25 15h14v4l4 4v29a4 4 0 0 1-4 4H25a4 4 0 0 1-4-4V23l4-4z"/>
    <path d="M22 40h20v14H22z" fill="${A}" fill-opacity=".3" stroke="none"/>
    <path d="M24 27h16v10H24z"/>${T(l, 32, 34.5, fit(l, 14.5))}`,
  // ampola de vidro
  ampola: l => `
    <path d="M28 6h8v6l-2 4 2 4v4l4 4v24a4 4 0 0 1-4 4h-8a4 4 0 0 1-4-4V28l4-4v-4l2-4-2-4z"/>
    <path d="M25 40h14v14H25z" fill="${A}" fill-opacity=".35" stroke="none"/>
    <path d="M26 30h12" stroke-opacity=".5"/>${T(l, 32, 37, fit(l, 12))}`,
  // cartela de comprimidos
  blister: l => `
    <rect x="12" y="8" width="40" height="46" rx="4"/>
    ${[0, 1, 2, 3].map(r => [0, 1].map(c => `<ellipse cx="${24 + c * 16}" cy="${16 + r * 9}" rx="5" ry="3.2" fill="${A}" fill-opacity=".45"/>`).join('')).join('')}
    ${T(l, 32, 61, 7)}`,
  // caixa de medicamento
  remedio: l => `
    <path d="M10 22l14-8h30l-14 8z"/><path d="M10 22h30v32H10z" fill="${A}" fill-opacity=".2"/><path d="M40 22l14-8v32l-14 8"/>
    <path d="M22 30h6v4h4v6h-4v4h-6v-4h-4v-6h4z"/>${T(l, 25, 50, fit(l, 26))}`,
  // genérico: caixa com a inicial
  generico: l => `
    <path d="M10 22l14-8h30l-14 8z"/><path d="M10 22h30v32H10z" fill="${A}" fill-opacity=".2"/><path d="M40 22l14-8v32l-14 8"/>
    ${T(l, 25, 44, 14)}`,
};

// regras: a primeira que bater com o nome do produto vence
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const RULES = [
  [/ALCOOL/, () => D.frasco('70%')],
  [/CLOREXIDINA/, () => D.galao('2%')],
  [/SERINGA.*?(\d+\s*ML)/, m => D.seringa(m[1].replace(/\s*ML/i, ' ml'))],
  [/SERINGA.*?(\d+)\s*UI?\b/, m => D.seringa(`${m[1]} UI`, true)],
  [/SERINGA/, () => D.seringa('')],
  [/CANULA/, () => D.canula('22G')],
  [/AGULHA\s*(\d+G)/, m => D.agulha(m[1], Number(m[1].replace('G', '')) <= 22 ? 2.6 : 1.3)],
  [/XILESTESIN.*(S\/|\bSEM)\s*VASO/, () => D.tubete('Sem vaso')],
  [/XILESTESIN|ANESTESICO/, () => D.tubete('Com vaso')],
  [/PERFURO/, () => D.caixa()],
  [/CAMPO/, () => D.campo()],
  [/COTONETE/, () => D.cotonete()],
  [/DEMAQUILANTE.*LENC/, () => D.lencos()],
  [/DEMAQUILANTE/, () => D.flip('Demaq.')],
  [/ALGODAO/, () => D.discos()],
  [/\bFIO\b/, () => D.fio('2.0')],
  [/FLACONETE.*AGUA/, () => D.flaconete('Água')],
  [/FLACONETE|SORO/, () => D.flaconete('Soro')],
  [/GAZE/, () => D.gaze()],
  [/GORRO/, () => D.gorro()],
  [/LABIAL/, () => D.labial()],
  [/\bKIT\b/, () => D.kit()],
  [/LAMINA|BISTURI/, () => D.lamina('Nº 11')],
  [/LUVA.*?(\d+[.,]\d)/, m => D.luva(m[1].replace('.', ','))],
  [/LUVA\s*(\w+)/, m => D.luva(m[1])],
  [/MASCARA/, () => D.mascara()],
  [/PAPEL GRAU/, () => D.rolo('5 cm')],
  [/ROLOPACK/, () => D.rolo('')],
  [/PINCEL/, () => D.pincel()],
  [/POMADA DIPROGENTA/, () => D.pomada('Diprogenta')],
  [/POMADA/, () => D.pomada('Anest.')],
  [/SACO|LIXO/, () => D.saco()],
  [/TORNEIRINHA/, () => D.torneira()],
  [/TRANEXAMICO/, () => D.ampola('Tranex.')],
  [/DIPIRONA/, () => D.ampola('1 g')],
  [/DEXAMETASONA/, () => D.ampola('Dexa')],
  [/HIALURONIDASE/, () => D.vial('Hial.')],
  [/DIPROSPAN/, () => D.vial('Diprospan')],
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
  // o texto fica fora do filtro para continuar legível
  const texts = (body.match(/<text[\s\S]*?<\/text>/g) || []).join('');
  const shapes = body.replace(/<text[\s\S]*?<\/text>/g, '');
  return `<svg class="ill" viewBox="0 0 64 64" role="img" aria-hidden="true" fill="none" stroke="currentColor"
    stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><g filter="url(#kf-rabisco)">${shapes}</g>${texts}</svg>`;
}

// filtro "rabisco": colocado uma vez na página
export const SKETCH_FILTER = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="kf-rabisco" x="-5%" y="-5%" width="110%" height="110%">
  <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" xChannelSelector="R" yChannelSelector="G"/></filter></svg>`;
