// Conversão da foto em desenho de traço, feita no próprio celular (sem servidor).
// Algoritmo: tons de cinza -> desfoque gaussiano -> Sobel -> supressão de não-máximos
// -> limiar duplo com histerese (detector de bordas de Canny) -> traço preto em fundo branco.

export function lineArtFromRGBA(px, w, h, opts = {}) {
  const n = w * h;
  const gray = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = px[j + 3] / 255; // transparente vira branco
    gray[i] = (0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2]) * a + 255 * (1 - a);
  }

  // desfoque gaussiano separável [1 4 6 4 1]/16, aplicado 1 ou 2 vezes conforme o tamanho
  const passes = opts.blurPasses ?? (Math.max(w, h) > 500 ? 2 : 1);
  let g = gray;
  const tmp = new Float32Array(n);
  const k = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let t = -2; t <= 2; t++) {
          const xx = Math.min(w - 1, Math.max(0, x + t));
          s += g[row + xx] * k[t + 2];
        }
        tmp[row + x] = s;
      }
    }
    const out = new Float32Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let t = -2; t <= 2; t++) {
          const yy = Math.min(h - 1, Math.max(0, y + t));
          s += tmp[yy * w + x] * k[t + 2];
        }
        out[y * w + x] = s;
      }
    }
    g = out;
  }

  // Sobel
  const mag = new Float32Array(n);
  const dir = new Uint8Array(n); // 0: horizontal, 1: 45°, 2: vertical, 3: 135°
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1] + g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1];
      const gy = -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1] + g[i + w - 1] + 2 * g[i + w] + g[i + w + 1];
      mag[i] = Math.hypot(gx, gy);
      let ang = Math.atan2(gy, gx) * 180 / Math.PI;
      if (ang < 0) ang += 180;
      dir[i] = ang < 22.5 || ang >= 157.5 ? 0 : ang < 67.5 ? 1 : ang < 112.5 ? 2 : 3;
    }
  }

  // supressão de não-máximos (deixa o traço fino)
  const nms = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const m = mag[i];
      if (m === 0) continue;
      let a, b;
      switch (dir[i]) {
        case 0: a = mag[i - 1]; b = mag[i + 1]; break;
        case 1: a = mag[i - w + 1]; b = mag[i + w - 1]; break;
        case 2: a = mag[i - w]; b = mag[i + w]; break;
        default: a = mag[i - w - 1]; b = mag[i + w + 1];
      }
      if (m >= a && m >= b) nms[i] = m;
    }
  }

  // limiares automáticos a partir das bordas existentes
  const vals = [];
  for (let i = 0; i < n; i++) if (nms[i] > 0) vals.push(nms[i]);
  vals.sort((a, b) => a - b);
  const pct = q => (vals.length ? vals[Math.min(vals.length - 1, Math.floor(vals.length * q))] : 0);
  const high = Math.max(opts.minHigh ?? 40, pct(opts.highQuantile ?? 0.8));
  const low = high * (opts.lowRatio ?? 0.4);

  // histerese: mantém bordas fracas ligadas a bordas fortes
  const edge = new Uint8Array(n);
  const stack = [];
  for (let i = 0; i < n; i++) {
    if (nms[i] >= high && !edge[i]) {
      edge[i] = 1;
      stack.push(i);
      while (stack.length) {
        const c = stack.pop();
        const cx = c % w, cy = (c - cx) / w;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = cx + dx, yy = cy + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const j = yy * w + xx;
            if (!edge[j] && nms[j] >= low) { edge[j] = 1; stack.push(j); }
          }
        }
      }
    }
  }

  // engrossa o traço em imagens maiores para ficar visível no celular
  let line = edge;
  const thick = opts.thicken ?? (Math.max(w, h) >= 600 ? 1 : 0);
  for (let t = 0; t < thick; t++) {
    const d = new Uint8Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (line[i] || (x > 0 && line[i - 1]) || (x < w - 1 && line[i + 1]) ||
            (y > 0 && line[i - w]) || (y < h - 1 && line[i + w])) d[i] = 1;
      }
    }
    line = d;
  }

  const out = new Uint8ClampedArray(n * 4);
  let count = 0;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const v = line[i] ? 30 : 255;
    if (line[i]) count++;
    out[j] = out[j + 1] = out[j + 2] = v;
    out[j + 3] = 255;
  }
  return { data: out, inkRatio: count / n };
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível abrir a imagem')); };
    img.src = url;
  });
}

function fit(w, h, max) {
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Falha ao gerar imagem'))), type, quality));
}

/**
 * Recebe o arquivo da câmera/galeria e devolve:
 *  original: JPEG (lado maior até 1600 px) para guardar ao lado do desenho
 *  lineart:  PNG com o desenho de traço (lado maior até 800 px)
 * A orientação da foto (EXIF) é respeitada pelo navegador ao desenhar no canvas.
 */
export async function processPhoto(file) {
  const img = await loadImage(file);
  const W = img.naturalWidth, H = img.naturalHeight;

  const o = fit(W, H, 1600);
  const c1 = document.createElement('canvas');
  c1.width = o.w; c1.height = o.h;
  const x1 = c1.getContext('2d');
  x1.fillStyle = '#fff';
  x1.fillRect(0, 0, o.w, o.h);
  x1.drawImage(img, 0, 0, o.w, o.h);
  const original = await toBlob(c1, 'image/jpeg', 0.85);

  const l = fit(W, H, 800);
  const c2 = document.createElement('canvas');
  c2.width = l.w; c2.height = l.h;
  const x2 = c2.getContext('2d', { willReadFrequently: true });
  x2.fillStyle = '#fff';
  x2.fillRect(0, 0, l.w, l.h);
  x2.drawImage(img, 0, 0, l.w, l.h);
  const src = x2.getImageData(0, 0, l.w, l.h);
  // libera a tela para o navegador desenhar o "processando..."
  await new Promise(r => setTimeout(r, 0));
  const { data } = lineArtFromRGBA(src.data, l.w, l.h);
  x2.putImageData(new ImageData(data, l.w, l.h), 0, 0);
  const lineart = await toBlob(c2, 'image/png');
  c1.width = c1.height = c2.width = c2.height = 0; // libera memória (importante no iPhone)
  return { original, lineart };
}

// versão 0.9: foto da prateleira para a contagem por foto (JPEG, lado maior até 1800 px, orientação respeitada)
export async function shelfJpeg(file, max = 1800) {
  const img = await loadImage(file);
  const o = fit(img.naturalWidth, img.naturalHeight, max);
  const c = document.createElement('canvas');
  c.width = o.w; c.height = o.h;
  const x = c.getContext('2d');
  x.fillStyle = '#fff';
  x.fillRect(0, 0, o.w, o.h);
  x.drawImage(img, 0, 0, o.w, o.h);
  const blob = await toBlob(c, 'image/jpeg', 0.85);
  c.width = c.height = 0;
  return blob;
}
