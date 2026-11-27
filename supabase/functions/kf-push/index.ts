// Estoque KF: envio de notificações push (Web Push com VAPID), sem bibliotecas externas.
// As chaves VAPID são geradas aqui dentro na primeira chamada e ficam na tabela kf_push_config
// (ninguém precisa copiar chave secreta). O banco chama esta função com o segredo de kf_push_config.
//
// Ações (POST JSON):
//   { acao: 'chave' }                                  -> { chave: <chave pública VAPID> }
//   { acao: 'enviar', title, body, badge, segredo }    -> envia para os celulares do dono
//   { acao: 'enviar', todos: true, ... }               -> envia para todos os membros (lembrete da conferência, v0.8)
//   { acao: 'teste', endpoint }                        -> envia uma notificação de teste para esse celular
// Implanta com "Enforce JWT verification" desligado.

const env = (k: string) => (globalThis as any).Deno?.env.get(k) as string;
const URL_DB = env('SUPABASE_URL');
const SRK = env('SUPABASE_SERVICE_ROLE_KEY');
const APP_URL = 'https://phdcar.github.io/estoque-kf/';

const enc = new TextEncoder();
const b64u = (buf: ArrayBuffer | Uint8Array) => {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ''; for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64u = (s: string) => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Uint8Array.from(atob(t), c => c.charCodeAt(0));
};
const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };

async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${URL_DB}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`db ${path}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

// ---------- chaves VAPID ----------
async function config() {
  const [c] = await db('kf_push_config?id=eq.1&select=*');
  if (c?.vapid_publica && c?.vapid_privada) return c;
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey));
  const priv = await crypto.subtle.exportKey('jwk', kp.privateKey);
  // só grava se ainda estiver vazio (duas chamadas ao mesmo tempo não trocam a chave)
  await db('kf_push_config?id=eq.1&vapid_publica=is.null', { method: 'PATCH', body: JSON.stringify({ vapid_publica: pub, vapid_privada: priv }) });
  const [c2] = await db('kf_push_config?id=eq.1&select=*');
  return c2;
}

export async function vapidHeader(endpoint: string, pub: string, privJwk: JsonWebKey) {
  const key = await crypto.subtle.importKey('jwk', privJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: APP_URL })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${body}`));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${pub}`;
}

// ---------- criptografia do conteúdo (RFC 8291, aes128gcm) ----------
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
export async function encrypt(plain: Uint8Array, p256dh: string, auth: string) {
  const ua = unb64u(p256dh), secret = unb64u(auth);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const as = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdf(secret, shared, cat(enc.encode('WebPush: info\0'), ua, as), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const k = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, k, cat(plain, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return cat(salt, rs, new Uint8Array([as.length]), as, ct);
}

async function send(sub: { endpoint: string; p256dh: string; auth: string }, payload: unknown, c: any) {
  const body = await encrypt(enc.encode(JSON.stringify(payload)), sub.p256dh, sub.auth);
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: await vapidHeader(sub.endpoint, c.vapid_publica, c.vapid_privada), TTL: '86400', Urgency: 'high', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream' },
    body,
  });
  if (r.status === 404 || r.status === 410) await db(`kf_push_inscricoes?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, { method: 'DELETE' });
  return r.status;
}

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

if ((globalThis as any).Deno?.serve) (globalThis as any).Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const q = await req.json().catch(() => ({}));
    const c = await config();
    if (q.acao === 'chave') return json({ chave: c.vapid_publica });
    if (q.acao === 'teste') {
      const [s] = await db(`kf_push_inscricoes?endpoint=eq.${encodeURIComponent(String(q.endpoint || ''))}&select=endpoint,p256dh,auth`);
      if (!s) return json({ erro: 'inscrição não encontrada' }, 404);
      const st = await send(s, { title: 'Estoque KF', body: 'Notificações ativadas neste celular.', badge: q.badge ?? null, url: APP_URL }, c);
      return json({ status: st });
    }
    if (q.acao === 'enviar') {
      if (!q.segredo || q.segredo !== c.segredo) return json({ erro: 'não autorizado' }, 401);
      const subs = await db(q.todos === true ? 'rpc/kf_push_destinos_todos' : 'rpc/kf_push_destinos', { method: 'POST', body: '{}' });
      const res = [];
      for (const s of subs) res.push(await send(s, { title: q.title || 'Estoque KF', body: q.body || '', badge: q.badge ?? null, url: APP_URL }, c).catch(e => String(e)));
      return json({ enviados: res });
    }
    return json({ erro: 'ação desconhecida' }, 400);
  } catch (e: any) {
    return json({ erro: String(e?.message || e) }, 500);
  }
});
