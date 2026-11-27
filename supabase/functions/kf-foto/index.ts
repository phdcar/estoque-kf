// Estoque KF: contagem por foto (versão 0.9).
// O funcionário tira uma foto da prateleira; o Claude olha a foto e sugere, para cada produto cadastrado
// que aparece nela, a quantidade, a validade e o lote. O app mostra as sugestões e a pessoa confirma.
//
// POST JSON { imagem: <JPEG em base64>, produtos: [{ id, nome, fornecedor? }] }  + cabeçalho x-kf-token (sessão de um membro)
//   -> { itens: [{ produto_id, quantidade, validade, lote, certeza, obs }], outros: [texto] }
// Precisa do segredo ANTHROPIC_API_KEY (Edge Functions → Secrets). Implanta com "Verify JWT" desligado.

const env = (k: string) => (globalThis as any).Deno?.env.get(k) as string;
const URL_DB = env('SUPABASE_URL');
const SRK = env('SUPABASE_SERVICE_ROLE_KEY');
const MODEL = 'claude-opus-5-5';

export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['itens', 'outros'],
  properties: {
    itens: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['produto_id', 'quantidade', 'validade', 'lote', 'certeza', 'obs'],
        properties: {
          produto_id: { type: 'string' },
          quantidade: { type: 'integer' },
          validade: { type: ['string', 'null'] },
          lote: { type: ['string', 'null'] },
          certeza: { type: 'string', enum: ['alta', 'media', 'baixa'] },
          obs: { type: 'string' },
        },
      },
    },
    outros: { type: 'array', items: { type: 'string' } },
  },
};

export function prompt(produtos: { id: string; nome: string; fornecedor?: string }[]) {
  const lista = produtos.map(p => `- id ${p.id}: ${p.nome}${p.fornecedor ? ` (fornecedor ${p.fornecedor})` : ''}`).join('\n');
  return `This is a photo of one shelf in the supply room of a small aesthetics clinic in Brazil. Staff use it for the weekly stock count.

Products registered in the stock system:
${lista}

For each registered product you can see in the photo, report:
- produto_id: the id from the list above (only products from this list; never invent ids)
- quantidade: how many units you count. A unit is what the clinic counts: a closed box counts as 1, a loose syringe counts as 1. If items are stacked or partly hidden, give your best count and lower the certeza.
- validade: the expiry date printed on the package, as AAAA-MM-DD, or AAAA-MM when only month and year are printed. null if you cannot read it. If several units show different dates, give the earliest one.
- lote: the lot/batch code printed on the package (often after "Lote", "Lot" or "L:"), or null if unreadable.
- certeza: "alta" if you are sure of the count, "media" if some items may be hidden, "baixa" if you are guessing.
- obs: a short note in Brazilian Portuguese (sentence case) when something matters, for example "2 caixas atrás, contei pela lateral". Empty string otherwise.

List in "outros" (short Brazilian Portuguese phrases) any products you see that are not in the list.
Leave out products you cannot see. Do not report a product with zero units.`;
}

// limpa a resposta: só ids conhecidos, quantidades inteiras >= 0, datas válidas
export function limpar(r: any, ids: Set<string>) {
  const data = (v: any) => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)) return s;
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) return s;
    return null;
  };
  const vistos = new Set<string>();
  const itens = (Array.isArray(r?.itens) ? r.itens : [])
    .filter((i: any) => ids.has(i?.produto_id) && !vistos.has(i.produto_id) && vistos.add(i.produto_id))
    .map((i: any) => ({
      produto_id: i.produto_id,
      quantidade: Math.max(0, Math.round(Number(i.quantidade) || 0)),
      validade: data(i.validade),
      lote: typeof i.lote === 'string' && i.lote.trim() ? i.lote.trim().slice(0, 40) : null,
      certeza: ['alta', 'media', 'baixa'].includes(i.certeza) ? i.certeza : 'baixa',
      obs: typeof i.obs === 'string' ? i.obs.trim().slice(0, 160) : '',
    }));
  const outros = (Array.isArray(r?.outros) ? r.outros : []).filter((x: any) => typeof x === 'string' && x.trim()).map((x: string) => x.trim().slice(0, 80)).slice(0, 10);
  return { itens, outros };
}

async function membroDoToken(token: string) {
  const r = await fetch(`${URL_DB}/auth/v1/user`, { headers: { apikey: SRK, Authorization: `Bearer ${token}` } });
  if (!r.ok) return false;
  const u = await r.json();
  const m = await fetch(`${URL_DB}/rest/v1/membros?user_id=eq.${u.id}&select=papel`, { headers: { apikey: SRK, Authorization: `Bearer ${SRK}` } });
  if (!m.ok) return false;
  return (await m.json()).length > 0;
}

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info, x-kf-token', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

if ((globalThis as any).Deno?.serve) (globalThis as any).Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const token = req.headers.get('x-kf-token') || '';
    if (!token || !(await membroDoToken(token))) return json({ erro: 'Entre na conta da clínica primeiro.' }, 403);
    if (!env('ANTHROPIC_API_KEY')) return json({ erro: 'A contagem por foto ainda não foi ligada (falta a chave da Anthropic no Supabase).' }, 503);
    const q = await req.json().catch(() => ({}));
    const imagem = typeof q.imagem === 'string' ? q.imagem.replace(/^data:image\/\w+;base64,/, '') : '';
    if (!imagem || imagem.length > 7_000_000) return json({ erro: 'Foto ausente ou grande demais.' }, 400);
    const produtos = (Array.isArray(q.produtos) ? q.produtos : [])
      .filter((p: any) => typeof p?.id === 'string' && typeof p?.nome === 'string').slice(0, 300)
      .map((p: any) => ({ id: p.id, nome: p.nome.slice(0, 120), fornecedor: typeof p.fornecedor === 'string' ? p.fornecedor.slice(0, 60) : '' }));
    if (!produtos.length) return json({ erro: 'Nenhum produto cadastrado.' }, 400);

    const { default: Anthropic } = await import('npm:@anthropic-ai/sdk');
    const client = new Anthropic();
    const msg: any = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imagem } },
          { type: 'text', text: prompt(produtos) },
        ],
      }],
    } as any);
    if (msg.stop_reason === 'refusal') return json({ erro: 'Não foi possível analisar esta foto. Tente outra.' }, 422);
    if (msg.stop_reason === 'max_tokens') return json({ erro: 'A análise da foto ficou incompleta. Tente uma foto com menos produtos.' }, 422);
    const texto = (msg.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    let bruto: any;
    try { bruto = JSON.parse(texto); } catch { return json({ erro: 'Resposta inesperada. Tente de novo.' }, 502); }
    return json(limpar(bruto, new Set(produtos.map((p: any) => p.id))));
  } catch (e: any) {
    const status = Number(e?.status) || 500;
    return json({ erro: status === 429 ? 'Muitas fotos seguidas. Espere um minuto e tente de novo.' : 'Não foi possível analisar a foto agora. Tente de novo.' , detalhe: String(e?.message || e).slice(0, 300) }, status >= 400 && status < 600 ? status : 500);
  }
});
