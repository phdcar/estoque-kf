// Servidor Supabase FALSO, só para os testes automáticos (o servidor de testes não alcança o Supabase real).
// Imita o suficiente de Auth, PostgREST, RPC e Storage para o app funcionar entre dois "celulares".
// As regras de acesso (RLS) de verdade são testadas à parte, em tests/sql.
import { randomUUID } from 'node:crypto';

export const FAKE_URL = 'https://fake-supabase.test';

export class FakeSupabase {
  constructor() {
    this.users = new Map();   // email -> { id, email, password, meta }
    this.tokens = new Map();  // token -> userId
    this.tables = {
      membros: [],
      config: [{ id: 1, inicio: new Date().toISOString().slice(0, 10), prazo: '18:00', codigo_convite: 'ABC123', atualizado_em: new Date().toISOString(), servidor_em: new Date().toISOString() }],
      produtos: [],
      conferencias: [],
      movimentos: [],
      pedidos: [],
    };
    this.files = new Map();   // caminho -> { body: Buffer, type }
    this.log = [];
    this.down = false;        // simula servidor fora do ar
    this.seq = 0;
  }

  stamp() { // horário do servidor, sempre crescente
    const t = Date.now() + (this.seq++);
    return new Date(t).toISOString();
  }

  async attach(context) {
    await context.route(FAKE_URL + '/**', route => this.handle(route).catch(e => {
      console.error('fake-supabase', e);
      return route.fulfill({ status: 500, json: { message: String(e) } });
    }));
  }

  session(user) {
    const token = `tok-${user.id}-${randomUUID()}`;
    this.tokens.set(token, user.id);
    const refresh = `ref-${user.id}-${randomUUID()}`;
    this.tokens.set(refresh, user.id);
    return { access_token: token, token_type: 'bearer', expires_in: 315360000, refresh_token: refresh, user: this.publicUser(user) };
  }

  publicUser(u) {
    return { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, user_metadata: u.meta || {}, app_metadata: {}, created_at: u.created };
  }

  uid(req) {
    const h = req.headers()['authorization'] || '';
    const t = h.replace(/^Bearer /, '');
    return this.tokens.get(t) || null;
  }

  member(uid) { return this.tables.membros.find(m => m.user_id === uid); }

  async handle(route) {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    this.log.push(`${method} ${path}${url.search}`);
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } });
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (this.down) return route.abort('connectionrefused');
    const body = () => { try { return JSON.parse(req.postData() || 'null'); } catch { return null; } };

    // ---------- Auth ----------
    if (path === '/auth/v1/signup' && method === 'POST') {
      const { email, password, data } = body();
      if (this.users.has(email)) return json(422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
      if (!password || password.length < 6) return json(422, { code: 422, error_code: 'weak_password', msg: 'Password should be at least 6 characters.' });
      const u = { id: randomUUID(), email, password, meta: data || {}, created: new Date().toISOString() };
      this.users.set(email, u);
      return json(200, this.session(u));
    }
    if (path === '/auth/v1/token' && method === 'POST') {
      const grant = url.searchParams.get('grant_type');
      const b = body();
      if (grant === 'password') {
        const u = this.users.get(b.email);
        if (!u || u.password !== b.password) return json(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
        return json(200, this.session(u));
      }
      if (grant === 'refresh_token') {
        const id = this.tokens.get(b.refresh_token);
        const u = [...this.users.values()].find(x => x.id === id);
        if (!u) return json(400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
        return json(200, this.session(u));
      }
    }
    if (path === '/auth/v1/user' && method === 'GET') {
      const id = this.uid(req);
      const u = [...this.users.values()].find(x => x.id === id);
      return u ? json(200, this.publicUser(u)) : json(401, { code: 401, msg: 'invalid JWT' });
    }
    if (path === '/auth/v1/logout') return json(204);

    const uid = this.uid(req);

    // ---------- RPC ----------
    if (path.startsWith('/rest/v1/rpc/')) {
      const fn = path.split('/').pop();
      const b = body() || {};
      const err = m => json(400, { code: 'P0001', message: m, details: null, hint: null });
      if (!uid) return err('Faça login primeiro');
      if (fn === 'kf_entrar') {
        const m = this.member(uid);
        if (m) return json(200, m);
        if (!b.p_nome?.trim()) return err('Informe seu nome');
        const hasOwner = this.tables.membros.some(x => x.papel === 'dono');
        if (hasOwner && (!b.p_codigo || b.p_codigo.trim().toUpperCase() !== this.tables.config[0].codigo_convite)) return err('Código da clínica inválido');
        const row = { user_id: uid, nome: b.p_nome.trim(), papel: hasOwner ? 'funcionario' : 'dono', criado_em: this.stamp() };
        this.tables.membros.push(row);
        return json(200, row);
      }
      if (fn === 'kf_novo_codigo') {
        if (this.member(uid)?.papel !== 'dono') return err('Só o dono pode fazer isso');
        const c = Math.random().toString(16).slice(2, 8).toUpperCase();
        Object.assign(this.tables.config[0], { codigo_convite: c, servidor_em: this.stamp() });
        return json(200, c);
      }
      if (fn === 'kf_remover_membro') {
        if (this.member(uid)?.papel !== 'dono') return err('Só o dono pode fazer isso');
        this.tables.membros = this.tables.membros.filter(m => m.user_id !== b.p_user);
        return json(204);
      }
    }

    // ---------- tabelas ----------
    if (path.startsWith('/rest/v1/')) {
      const table = path.split('/')[3];
      const rows = this.tables[table];
      if (!rows) return json(404, { message: 'tabela desconhecida' });
      const isMember = !!this.member(uid);
      const filters = [...url.searchParams.entries()].filter(([k]) => !['select', 'order', 'limit', 'on_conflict'].includes(k));
      const match = r => filters.every(([k, v]) => {
        const [op, ...rest] = v.split('.');
        const val = rest.join('.');
        if (op === 'eq') return String(r[k]) === val;
        if (op === 'gt') return r[k] > val;
        throw new Error('filtro não suportado ' + v);
      });
      if (method === 'GET') {
        if (!isMember) return json(200, []); // RLS: quem não é membro não vê nada
        let out = rows.filter(match);
        const order = url.searchParams.get('order');
        if (order) { const [col, dir] = order.split('.'); out = [...out].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === 'desc' ? -1 : 1)); }
        const limit = url.searchParams.get('limit');
        if (limit) out = out.slice(0, Number(limit));
        return json(200, out);
      }
      if (!isMember) return json(403, { code: '42501', message: 'new row violates row-level security policy' });
      if (method === 'PATCH') {
        if (table === 'config' && this.member(uid).papel !== 'dono') return json(200, []);
        const b = body();
        rows.filter(match).forEach(r => Object.assign(r, b, { servidor_em: this.stamp() }));
        return json(204);
      }
      if (method === 'POST') {
        const prefer = req.headers()['prefer'] || '';
        const list = [].concat(body());
        for (const inc of list) {
          const cur = rows.find(r => r.id === inc.id);
          if (table === 'conferencias' || table === 'movimentos') inc.por_user = uid;
          if (!cur) { rows.push({ ...inc, servidor_em: this.stamp() }); continue; }
          if (prefer.includes('ignore-duplicates')) continue;
          if (!prefer.includes('merge-duplicates')) return json(409, { code: '23505', message: 'duplicate key' });
          if ((table === 'produtos' || table === 'pedidos') && inc.atualizado_em < cur.atualizado_em) continue; // a mais recente vence
          Object.assign(cur, inc, { servidor_em: this.stamp() });
        }
        return json(201);
      }
    }

    // ---------- Storage ----------
    if (path.startsWith('/storage/v1/object/')) {
      if (!this.member(uid)) return json(403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
      const key = decodeURIComponent(path.replace('/storage/v1/object/', '').replace(/^authenticated\//, ''));
      if (method === 'POST' || method === 'PUT') {
        const ct = req.headers()['content-type'] || '';
        const buf = req.postDataBuffer();
        const file = ct.startsWith('multipart/form-data') ? parseMultipartFile(buf, ct) : { body: buf, type: ct };
        if (this.files.has(key) && req.headers()['x-upsert'] !== 'true') return json(400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
        this.files.set(key, file);
        return json(200, { Key: key, Id: randomUUID() });
      }
      if (method === 'GET') {
        const f = this.files.get(key);
        if (!f) return json(400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
        return route.fulfill({ status: 200, contentType: f.type, body: f.body, headers: { 'access-control-allow-origin': '*' } });
      }
    }
    return json(404, { message: 'rota não imitada: ' + method + ' ' + path });
  }
}

function parseMultipartFile(buf, ct) {
  const boundary = '--' + ct.split('boundary=')[1];
  const parts = [];
  let i = buf.indexOf(boundary);
  while (i !== -1) {
    const next = buf.indexOf(boundary, i + boundary.length);
    if (next === -1) break;
    parts.push(buf.subarray(i + boundary.length + 2, next - 2)); // tira \r\n
    i = next;
  }
  for (const p of parts) {
    const sep = p.indexOf('\r\n\r\n');
    const head = p.subarray(0, sep).toString();
    if (!/filename=/.test(head)) continue;
    const type = (head.match(/Content-Type:\s*([^\r\n]+)/i) || [])[1] || 'application/octet-stream';
    return { body: Buffer.from(p.subarray(sep + 4)), type };
  }
  throw new Error('arquivo não encontrado no envio');
}
