// Leitor de código de barras pela câmera (versão 0.7).
// Usa o leitor nativo do navegador quando existe (Android/Chrome) e, se não, a biblioteca ZXing
// (js/vendor/zxing-0.21.3.min.js, licença Apache 2.0), que funciona no Safari do iPhone.
// scanBarcode() abre a câmera numa tela por cima e devolve o código lido (ou null se a pessoa fechar).

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code', 'data_matrix'];
let zxingPromise = null;

function loadZXing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (!zxingPromise) {
    zxingPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL('./vendor/zxing-0.21.3.min.js', import.meta.url).href;
      s.onload = () => resolve(window.ZXing);
      s.onerror = () => { zxingPromise = null; reject(new Error('Não foi possível carregar o leitor de código.')); };
      document.head.appendChild(s);
    });
  }
  return zxingPromise;
}

export const scannerSupported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

// Para os testes: window.__KF_FAKE_SCAN = '789...' faz o leitor devolver esse código sem abrir a câmera.
export function scanBarcode(title = 'Aponte a câmera para o código de barras') {
  return new Promise(resolve => {
    const box = document.createElement('div');
    box.className = 'scanner';
    box.innerHTML = `<div class="scan-top"><span>${title}</span><button type="button" class="ghost" data-x aria-label="Fechar">Fechar</button></div>
      <div class="scan-view"><video playsinline muted autoplay></video><i class="scan-frame"></i></div>
      <p class="scan-msg">Abrindo a câmera…</p>
      <form class="scan-manual"><input type="text" inputmode="numeric" placeholder="Ou digite o código" aria-label="Digite o código">
      <button type="submit" class="secondary">Usar</button></form>`;
    document.body.appendChild(box);
    const video = box.querySelector('video');
    const msg = box.querySelector('.scan-msg');
    let stream = null, stopped = false, reader = null, raf = 0;
    const finish = code => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(raf);
      try { reader && reader.reset(); } catch { /* ignore */ }
      if (stream) stream.getTracks().forEach(t => t.stop());
      box.remove();
      if (code && navigator.vibrate) navigator.vibrate(60);
      resolve(code ? String(code).trim() : null);
    };
    box.querySelector('[data-x]').onclick = () => finish(null);
    box.querySelector('.scan-manual').onsubmit = e => { e.preventDefault(); const v = e.target.querySelector('input').value.trim(); if (v) finish(v); };
    if (window.__KF_FAKE_SCAN) { setTimeout(() => finish(window.__KF_FAKE_SCAN), 300); return; }
    if (!scannerSupported()) { msg.textContent = 'Este navegador não deixa usar a câmera. Digite o código abaixo.'; return; }

    (async () => {
      try {
        if ('BarcodeDetector' in window) {
          const supported = await window.BarcodeDetector.getSupportedFormats().catch(() => []);
          const formats = FORMATS.filter(f => supported.includes(f));
          if (formats.length) {
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
            if (stopped) return finish(null);
            video.srcObject = stream;
            await video.play();
            msg.textContent = 'Procurando o código…';
            const det = new window.BarcodeDetector({ formats });
            const loop = async () => {
              if (stopped) return;
              try { const r = await det.detect(video); if (r.length) return finish(r[0].rawValue); } catch { /* quadro ruim */ }
              raf = requestAnimationFrame(loop);
            };
            loop();
            return;
          }
        }
        const ZX = await loadZXing();
        if (stopped) return;
        reader = new ZX.BrowserMultiFormatReader();
        msg.textContent = 'Procurando o código…';
        await reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } }, audio: false }, video, (res) => {
          if (res) finish(res.getText());
        });
      } catch (e) {
        msg.textContent = /NotAllowed|Permission/i.test(e?.name + e?.message)
          ? 'Sem permissão para usar a câmera. Libere nos Ajustes do celular ou digite o código abaixo.'
          : 'Não foi possível abrir a câmera. Digite o código abaixo.';
      }
    })();
  });
}
