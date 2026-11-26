// Confere a criptografia do push (RFC 8291) decifrando com a biblioteca http_ece (referência).
// Rodar: NODE_PATH=<pasta com http_ece> node --experimental-strip-types tests/push/encrypt.test.mjs
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const require = createRequire(process.env.ECE_DIR + '/');
const ece = require('http_ece');
const { encrypt } = await import('../../supabase/functions/kf-push/index.ts');
const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
const auth = crypto.randomBytes(16);
const b64u = b => Buffer.from(b).toString('base64url');
const msg = JSON.stringify({ title: 'Estoque KF', body: 'Gaze: 30 → 4 · ação', badge: 3 });
const body = await encrypt(new TextEncoder().encode(msg), b64u(ua.getPublicKey()), b64u(auth));
const out = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: ua, authSecret: b64u(auth) });
assert.equal(out.toString(), msg);
console.log('push: criptografia OK (decifrada pela biblioteca de referência)');
// cabeçalho VAPID: JWT ES256 válido para a chave pública
{
  const { vapidHeader } = await import('../../supabase/functions/kf-push/index.ts');
  const kp = await crypto.webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = b64u(new Uint8Array(await crypto.webcrypto.subtle.exportKey('raw', kp.publicKey)));
  const jwk = await crypto.webcrypto.subtle.exportKey('jwk', kp.privateKey);
  const h = await vapidHeader('https://web.push.apple.com/QGuQyavXutnMH', pub, jwk);
  const m = h.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
  assert.ok(m); assert.equal(m[4], pub);
  const claims = JSON.parse(Buffer.from(m[2], 'base64url'));
  assert.equal(claims.aud, 'https://web.push.apple.com');
  assert.ok(claims.exp > Date.now() / 1000 && claims.exp < Date.now() / 1000 + 24 * 3600);
  const ok = await crypto.webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, Buffer.from(m[3], 'base64url'), new TextEncoder().encode(m[1] + '.' + m[2]));
  assert.equal(ok, true);
  console.log('push: assinatura VAPID OK');
}
