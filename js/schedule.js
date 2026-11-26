// Regras da conferência diária: todo dia útil (segunda a sexta), a partir da data inicial.
// Dia útil sem conferência precisa de justificativa escrita pelo funcionário.
// Fim de semana não tem conferência obrigatória.

export const LOOKBACK = 10; // quantos dias úteis para trás o app cobra justificativa

export function ymd(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function utc(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function diffDays(a, b) {
  return Math.round((utc(b) - utc(a)) / 864e5);
}

export function addDays(s, n) {
  return new Date(utc(s) + n * 864e5).toISOString().slice(0, 10);
}

export const isWeekday = s => { const w = new Date(utc(s)).getUTCDay(); return w >= 1 && w <= 5; };

export function isCountDay(day, start) {
  return day >= start && isWeekday(day);
}

// Dia útil mais recente (hoje ou antes) a partir da data inicial. null se ainda não começou.
export function latestDue(today, start) {
  for (let d = today; d >= start; d = addDays(d, -1)) if (isWeekday(d)) return d;
  return null;
}

// Próximo dia útil depois de hoje (ou a data inicial, se ainda não começou).
export function nextDue(today, start) {
  let d = today < start ? addDays(start, -1) : today;
  do d = addDays(d, 1); while (!isWeekday(d));
  return d;
}

// Dias úteis cobrados: depois da data inicial e com produto cadastrado antes do dia.
const charged = (d, start, productDays, productCount) =>
  isCountDay(d, start) && (productDays ? productDays.some(x => x < d) : productCount > 0);

const countOf = (counts, d) => counts.filter(c => c.date === d && !c.justification).sort((a, b) => a.at.localeCompare(b.at))[0];
const justOf = (counts, d) => counts.filter(c => c.justification && (c.days || [c.date]).includes(d)).sort((a, b) => a.at.localeCompare(b.at))[0];

// Dias úteis anteriores a hoje sem conferência e sem justificativa (mais antigo primeiro).
export function missingDays({ now, start, counts, productDays, productCount }) {
  const today = ymd(now);
  const out = [];
  for (let d = addDays(today, -1), n = 0; d >= start && n < LOOKBACK; d = addDays(d, -1)) {
    if (!isWeekday(d)) continue;
    n++;
    if (charged(d, start, productDays, productCount) && !countOf(counts, d) && !justOf(counts, d)) out.unshift(d);
  }
  return out;
}

/**
 * Situação da conferência agora.
 * state: 'sem-produtos' | 'primeiro-dia' | 'nao-iniciada' | 'fim-de-semana' | 'feita' | 'pendente' | 'atrasada'
 * missing: dias úteis passados sem conferência nem justificativa.
 * locked: true quando o funcionário deve ser bloqueado (falta justificar ou falta a contagem de hoje).
 */
export function countStatus({ now, start, deadline, counts, productCount, productDays }) {
  const today = ymd(now);
  const due = latestDue(today, start);
  const next = nextDue(today, start);
  const missing = missingDays({ now, start, counts, productDays, productCount });
  const base = { due, next, today, missing };
  if (!due) return { ...base, state: 'nao-iniciada', locked: false };
  if (!productCount) return { ...base, state: 'sem-produtos', locked: false };
  let state, count = null, locked = missing.length > 0;
  if (!isWeekday(today)) state = 'fim-de-semana';
  else if (!charged(today, start, productDays, productCount)) state = 'primeiro-dia';
  else if ((count = countOf(counts, today))) state = 'feita';
  else {
    const [hh, mm] = (deadline || '18:00').split(':').map(Number);
    state = now.getHours() * 60 + now.getMinutes() >= hh * 60 + mm ? 'atrasada' : 'pendente';
    locked = true;
  }
  return { ...base, state, count, locked };
}

// Histórico por dia útil (mais recente primeiro).
export function history({ now, start, deadline, counts, productDays, limit = 30 }) {
  const today = ymd(now);
  const rows = [];
  for (let d = today, i = 0; d >= start && i < limit; d = addDays(d, -1)) {
    if (!isWeekday(d)) continue;
    i++;
    const done = countOf(counts, d);
    const just = justOf(counts, d);
    let state;
    if (done) state = 'feita';
    else if (!charged(d, start, productDays, 1)) state = 'sem-cobranca';
    else if (just) state = 'justificada';
    else if (d === today) state = countStatus({ now, start, deadline, counts: [], productCount: 1 }).state;
    else state = 'nao-feita';
    rows.push({ day: d, state, count: done || null, justification: just || null });
  }
  return rows;
}

// Há quantos dias úteis o estoque não é conferido (para o aviso em cima do radar).
// Conta os dias úteis depois da última contagem até ontem; hoje entra só depois do prazo.
// Justificativa não conta como conferência.
export function sinceLastCount({ now, counts, deadline }) {
  const today = ymd(now);
  const last = counts.filter(c => !c.justification).sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at))[0] || null;
  const [hh, mm] = (deadline || '18:00').split(':').map(Number);
  const past = now.getHours() * 60 + now.getMinutes() >= hh * 60 + mm;
  if (!last) return { last: null, days: null, today: false };
  if (last.date >= today) return { last, days: 0, today: true };
  let days = 0;
  for (let d = addDays(last.date, 1); d < today; d = addDays(d, 1)) if (isWeekday(d)) days++;
  if (isWeekday(today) && past) days++;
  return { last, days, today: false, pendingToday: isWeekday(today) && !past };
}
