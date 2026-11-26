// Estoque KF: relatório mensal do estoque em PDF (versão 0.7).
// Ações (POST JSON):
//   { acao: 'baixar', mes: 'AAAA-MM' }  + cabeçalho x-kf-token (sessão do dono)  -> PDF
//   { acao: 'email',  mes: 'AAAA-MM' }  + cabeçalho x-kf-token (sessão do dono)  -> envia por e-mail
//   { acao: 'mensal', segredo }         (chamado pelo banco todo dia 1º)         -> envia o mês anterior
// Implanta com "Verify JWT" desligado (a função confere a sessão e o segredo sozinha).

const env = (k: string) => (globalThis as any).Deno?.env.get(k) as string;
const URL_DB = env('SUPABASE_URL');
const SRK = env('SUPABASE_SERVICE_ROLE_KEY');

async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${URL_DB}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`db ${path.split('?')[0]}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

// ---------- cálculos (os mesmos do app: js/insights.js) ----------
const CONSUME = ['saida', 'conferencia', 'ajuste'];
const brl = (v: number) => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const nomeMes = (m: string) => { const [y, mo] = m.split('-').map(Number); return `${MESES[mo - 1]} de ${y}`; };
const dia = (s: string) => s.slice(0, 10).split('-').reverse().join('/');
// mês no horário de Brasília
const mesDe = (iso: string) => new Date(Date.parse(iso) - 3 * 3600e3).toISOString().slice(0, 7);

export function resumo(d: { mes: string; hoje: string; produtos: any[]; movimentos: any[]; conferencias: any[]; pedidos: any[]; config: any }) {
  const ps = d.produtos.filter(p => !p.excluido);
  const ms = d.movimentos.filter(m => mesDe(m.feito_em) === d.mes);
  let gasto = 0, perdas = 0, perdasUn = 0;
  const forn = new Map<string, { nome: string; valor: number; un: number }>();
  const uso = new Map<string, { nome: string; un: number; valor: number }>();
  for (const m of ms) {
    const v = m.preco != null ? Number(m.preco) : 0;
    if (m.tipo === 'entrada' && m.delta > 0) {
      gasto += m.delta * v;
      const k = m.fornecedor || 'Sem fornecedor';
      const f = forn.get(k) || { nome: k, valor: 0, un: 0 }; f.valor += m.delta * v; f.un += m.delta; forn.set(k, f);
    }
    if (m.tipo === 'perda') { perdas += -m.delta * v; perdasUn += -m.delta; }
    if (CONSUME.includes(m.tipo)) {
      const u = uso.get(m.produto_id) || { nome: m.produto, un: 0, valor: 0 }; u.un -= m.delta; u.valor -= m.delta * v; uso.set(m.produto_id, u);
    }
  }
  let valor = 0, semPreco = 0;
  for (const p of ps) { if (p.preco != null) valor += Number(p.preco) * p.quantidade; else semPreco++; }
  // conferências: dias úteis do mês (do início das conferências até ontem)
  const [y, mo] = d.mes.split('-').map(Number);
  const dias: string[] = [];
  for (let k = 1; k <= 31; k++) {
    const dt = new Date(Date.UTC(y, mo - 1, k));
    if (dt.getUTCMonth() !== mo - 1) break;
    const s = dt.toISOString().slice(0, 10);
    const w = dt.getUTCDay();
    if (w >= 1 && w <= 5 && s >= (d.config?.inicio || '0000') && s < d.hoje) dias.push(s);
  }
  const feitos = new Set(d.conferencias.filter(c => !c.justificativa).map(c => String(c.dia).slice(0, 10)));
  const justs = d.conferencias.filter(c => c.justificativa && (c.dias || [c.dia]).some((x: string) => String(x).slice(0, 7) === d.mes));
  const justDias = new Set(justs.flatMap(c => (c.dias || [c.dia]).map((x: string) => String(x).slice(0, 10))));
  const feitas = dias.filter(x => feitos.has(x)).length;
  const justificadas = dias.filter(x => !feitos.has(x) && justDias.has(x)).length;
  const abaixo = ps.filter(p => p.minimo >= 1 && p.quantidade < p.minimo).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const vencimentos: { nome: string; validade: string; qtd: number }[] = [];
  const limite = new Date(Date.parse(d.hoje) + 60 * 864e5).toISOString().slice(0, 10);
  for (const p of ps) {
    const lotes = (p.lotes || []).filter((l: any) => l.qtd > 0);
    if (lotes.length) lotes.forEach((l: any) => { if (l.validade <= limite) vencimentos.push({ nome: p.nome, validade: l.validade, qtd: l.qtd }); });
    else if (p.validade && !p.sem_validade && String(p.validade).slice(0, 10) <= limite && p.quantidade > 0) vencimentos.push({ nome: p.nome, validade: String(p.validade).slice(0, 10), qtd: p.quantidade });
  }
  vencimentos.sort((a, b) => a.validade.localeCompare(b.validade));
  const pedidos = d.pedidos.filter(o => mesDe(o.criado_em) === d.mes && o.status !== 'cancelado');
  return {
    mes: d.mes, valor, semPreco, gasto, perdas, perdasUn, diasUteis: dias.length, feitas, justificadas, naoFeitas: dias.length - feitas - justificadas,
    fornecedores: [...forn.values()].sort((a, b) => b.valor - a.valor), uso: [...uso.values()].filter(u => u.un > 0).sort((a, b) => b.un - a.un),
    abaixo, vencimentos, pedidos, justificativas: justs, totalProdutos: ps.length,
  };
}

// ---------- PDF ----------
export async function montarPdf(PDFLib: any, r: ReturnType<typeof resumo>) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc = await PDFDocument.create();
  doc.setTitle(`Estoque Clínica KF · ${nomeMes(r.mes)}`);
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const fb = await doc.embedFont(StandardFonts.HelveticaBold);
  const NAVY = rgb(0.07, 0.1, 0.14), GOLD = rgb(0.8, 0.7, 0.49), MUTE = rgb(0.43, 0.4, 0.36), RED = rgb(0.7, 0.15, 0.12), LINE = rgb(0.9, 0.88, 0.83);
  const W = 595, H = 842, M = 48;
  let page: any, y = 0;
  const safe = (t: string) => String(t ?? '').replace(/[^\x20-\x7E -ÿ–—…•]/g, '');
  const novaPagina = () => {
    page = doc.addPage([W, H]);
    page.drawRectangle({ x: 0, y: H - 70, width: W, height: 70, color: NAVY });
    page.drawText('Clínica KF', { x: M, y: H - 38, size: 18, font: fb, color: rgb(0.95, 0.94, 0.91) });
    page.drawText('RELATÓRIO DO ESTOQUE · ' + safe(nomeMes(r.mes)).toUpperCase(), { x: M, y: H - 56, size: 9, font: f, color: GOLD });
    y = H - 100;
  };
  const precisa = (h: number) => { if (y - h < 60) novaPagina(); };
  const texto = (t: string, o: any = {}) => {
    const size = o.size || 10.5, font = o.bold ? fb : f, x = o.x ?? M;
    precisa(size + 6);
    page.drawText(safe(t), { x, y, size, font, color: o.color || NAVY });
    if (!o.keep) y -= size + (o.gap ?? 6);
  };
  const titulo = (t: string) => { y -= 10; precisa(40); texto(t, { size: 13, bold: true, gap: 4 }); page.drawLine({ start: { x: M, y: y + 2 }, end: { x: W - M, y: y + 2 }, thickness: 0.8, color: GOLD }); y -= 10; };
  const linha = (cols: [string, number, any?][]) => {
    precisa(18);
    for (const [t, x, o] of cols) {
      const size = o?.size || 10, font = o?.bold ? fb : f, s = safe(t);
      const xx = o?.right ? x - font.widthOfTextAtSize(s, size) : x;
      page.drawText(s, { x: xx, y, size, font, color: o?.color || NAVY });
    }
    y -= 6; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.4, color: LINE }); y -= 12;
  };
  const corta = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

  novaPagina();
  // cartões de resumo
  const cards: [string, string, string][] = [
    ['Valor em estoque', brl(r.valor), r.semPreco ? `${r.semPreco} produto(s) sem preço` : `${r.totalProdutos} produtos`],
    ['Gasto no mês', brl(r.gasto), 'entradas de mercadoria'],
    ['Perdas (vencidos)', brl(r.perdas), `${r.perdasUn} unidade(s)`],
    ['Conferências', `${r.feitas} de ${r.diasUteis}`, `${r.justificadas} justificada(s) · ${r.naoFeitas} sem justificativa`],
  ];
  const cw = (W - 2 * M - 12) / 2;
  cards.forEach(([a, b, c], i) => {
    const x = M + (i % 2) * (cw + 12), yy = y - Math.floor(i / 2) * 74;
    page.drawRectangle({ x, y: yy - 60, width: cw, height: 64, color: rgb(0.98, 0.97, 0.95), borderColor: LINE, borderWidth: 1 });
    page.drawText(safe(a), { x: x + 12, y: yy - 14, size: 9, font: f, color: MUTE });
    page.drawText(safe(b), { x: x + 12, y: yy - 36, size: 17, font: fb, color: (i === 2 && r.perdas) || (i === 3 && r.naoFeitas) ? RED : NAVY });
    page.drawText(safe(corta(c, 46)), { x: x + 12, y: yy - 52, size: 8.5, font: f, color: MUTE });
  });
  y -= 160;

  if (r.fornecedores.length) {
    titulo('Gasto por fornecedor');
    r.fornecedores.forEach(x => linha([[corta(x.nome, 50), M], [`${x.un} un`, W - M - 110, { right: true, color: MUTE }], [brl(x.valor), W - M, { right: true, bold: true }]]));
  }
  if (r.uso.length) {
    titulo('Mais usados no mês');
    r.uso.slice(0, 15).forEach(u => linha([[corta(u.nome, 55), M], [`${u.un} un`, W - M - 110, { right: true, bold: true }], [u.valor ? brl(u.valor) : '', W - M, { right: true, color: MUTE }]]));
  }
  titulo(`Abaixo do mínimo hoje (${r.abaixo.length})`);
  if (r.abaixo.length) r.abaixo.forEach(p => linha([[corta(p.nome, 50), M], [`tem ${p.quantidade}`, W - M - 110, { right: true, color: RED, bold: true }], [`mínimo ${p.minimo}`, W - M, { right: true, color: MUTE }]]));
  else texto('Nenhum produto abaixo do mínimo.', { color: MUTE });
  titulo(`Vencidos e a vencer em 60 dias (${r.vencimentos.length})`);
  if (r.vencimentos.length) r.vencimentos.forEach(v => linha([[corta(v.nome, 50), M], [`${v.qtd} un`, W - M - 110, { right: true }], [dia(v.validade), W - M, { right: true, bold: true, color: v.validade < new Date().toISOString().slice(0, 10) ? RED : NAVY }]]));
  else texto('Nada vencido nem vencendo nos próximos 60 dias.', { color: MUTE });
  if (r.pedidos.length) {
    titulo('Pedidos de compra');
    r.pedidos.forEach((o: any) => linha([[corta(o.fornecedor, 40), M], [dia(o.criado_em), W - M - 110, { right: true, color: MUTE }], [o.status === 'recebido' ? 'Recebido' : 'Em andamento', W - M, { right: true, bold: true }]]));
  }
  if (r.justificativas.length) {
    titulo('Justificativas de conferência');
    r.justificativas.forEach((j: any) => {
      texto(`${j.por_nome} · ${(j.dias || [j.dia]).map(dia).join(', ')}`, { bold: true, size: 10, gap: 3 });
      texto(`"${corta(j.justificativa, 95)}"`, { size: 10, color: MUTE, gap: 10 });
    });
  }
  y -= 10;
  texto(`Gerado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} pelo app de estoque.`, { size: 8.5, color: MUTE });
  return doc.save();
}

// ---------- envio ----------
const b64 = (u8: Uint8Array) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };

async function dados(mes: string) {
  const [y, mo] = mes.split('-').map(Number);
  const ini = new Date(Date.UTC(y, mo - 1, 1, 3)).toISOString();
  const fim = new Date(Date.UTC(y, mo, 1, 3)).toISOString();
  const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const [produtos, movimentos, conferencias, pedidos, cfg] = await Promise.all([
    db('produtos?select=*'),
    db(`movimentos?select=*&feito_em=gte.${ini}&feito_em=lt.${fim}`),
    db(`conferencias?select=*&or=(dia.gte.${mes}-01,justificativa.not.is.null)`),
    db(`pedidos?select=*&criado_em=gte.${ini}&criado_em=lt.${fim}`),
    db('config?id=eq.1&select=inicio'),
  ]);
  return resumo({ mes, hoje, produtos, movimentos, conferencias: conferencias.filter((c: any) => String(c.dia).slice(0, 7) === mes || c.justificativa), pedidos, config: cfg[0] });
}

async function pdfDoMes(mes: string) {
  const PDFLib = await import('npm:pdf-lib@1.17.1');
  return montarPdf(PDFLib, await dados(mes));
}

async function enviar(mes: string, pdf: Uint8Array) {
  const env = await db('rpc/kf_relatorio_envio', { method: 'POST', body: '{}' });
  if (!env?.email) throw new Error('Falta o e-mail de destino dos avisos.');
  if (!env?.chave) throw new Error('Falta a chave do Resend no Vault.');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${env.chave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Estoque Clínica KF <onboarding@resend.dev>', to: [env.email], subject: `Estoque KF · Relatório de ${nomeMes(mes)}`,
      html: `<div style="font-family:Arial,sans-serif;color:#121A24"><p>Segue em anexo o relatório do estoque de <b>${nomeMes(mes)}</b>: valor em estoque, gasto por fornecedor, consumo, perdas, conferências e vencimentos.</p><p style="color:#6E675C;font-size:12px">Envio automático do app de estoque da Clínica KF.</p></div>`,
      attachments: [{ filename: `estoque-kf-${mes}.pdf`, content: b64(pdf) }],
    }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
  return env.email as string;
}

async function donoDoToken(token: string) {
  const r = await fetch(`${URL_DB}/auth/v1/user`, { headers: { apikey: SRK, Authorization: `Bearer ${token}` } });
  if (!r.ok) return false;
  const u = await r.json();
  const [m] = await db(`membros?user_id=eq.${u.id}&select=papel`);
  return m?.papel === 'dono';
}

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info, x-kf-token', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

if ((globalThis as any).Deno?.serve) (globalThis as any).Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const q = await req.json().catch(() => ({}));
    if (q.acao === 'mensal') {
      const [c] = await db('kf_push_config?id=eq.1&select=segredo');
      if (!q.segredo || q.segredo !== c?.segredo) return json({ erro: 'não autorizado' }, 401);
      const d = new Date(Date.now() - 3 * 3600e3); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1);
      const mes = d.toISOString().slice(0, 7);
      return json({ enviado: await enviar(mes, await pdfDoMes(mes)), mes });
    }
    const token = req.headers.get('x-kf-token') || '';
    if (!token || !(await donoDoToken(token))) return json({ erro: 'Só o dono pode gerar o relatório.' }, 403);
    const mes = /^\d{4}-\d{2}$/.test(q.mes || '') ? q.mes : new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 7);
    const pdf = await pdfDoMes(mes);
    if (q.acao === 'baixar') return new Response(pdf, { headers: { ...cors, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="estoque-kf-${mes}.pdf"` } });
    if (q.acao === 'email') return json({ para: await enviar(mes, pdf), mes });
    return json({ erro: 'ação desconhecida' }, 400);
  } catch (e: any) {
    return json({ erro: String(e?.message || e) }, 500);
  }
});
