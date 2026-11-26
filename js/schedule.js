// Regras da conferência "dia sim, dia não".
// Dias de conferência: data inicial, +2, +4, ... (datas locais AAAA-MM-DD).

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

export function isCountDay(day, start) {
  const n = diffDays(start, day);
  return n >= 0 && n % 2 === 0;
}

// Dia de conferência mais recente que já chegou (hoje ou antes). null se ainda não começou.
export function latestDue(today, start) {
  const n = diffDays(start, today);
  if (n < 0) return null;
  return addDays(start, n - (n % 2));
}

// Próximo dia de conferência depois de hoje.
export function nextDue(today, start) {
  const n = diffDays(start, today);
  if (n < 0) return start;
  return addDays(start, n % 2 === 0 ? n + 2 : n + 1);
}

/**
 * Situação da conferência agora.
 * state: 'sem-produtos' | 'primeiro-dia' | 'nao-iniciada' | 'feita' | 'pendente' | 'atrasada'
 * locked: true quando o funcionário deve ser bloqueado até concluir a contagem.
 * Uma conferência feita com atraso (no dia seguinte) cobre o dia que ficou para trás.
 */
export function countStatus({ now, start, deadline, counts, productCount, productDays }) {
  const today = ymd(now);
  const due = latestDue(today, start);
  const next = nextDue(today, start);
  if (!due) return { state: 'nao-iniciada', due, next, today, locked: false };
  // Só cobra a conferência se já havia produto cadastrado antes do dia de conferência.
  // (Assim, quem cadastra o primeiro produto num dia de conferência não fica bloqueado na hora.)
  const n = productDays ? productDays.filter(d => d < due).length : productCount;
  if (!n) return { state: productCount ? 'primeiro-dia' : 'sem-produtos', due, next, today, locked: false };
  const done = counts
    .filter(c => c.date >= due)
    .sort((a, b) => a.at.localeCompare(b.at))[0];
  if (done) return { state: 'feita', due, next, today, count: done, locked: false };
  const [hh, mm] = (deadline || '18:00').split(':').map(Number);
  const minutes = now.getHours() * 60 + now.getMinutes();
  const late = due < today || minutes >= hh * 60 + mm;
  return { state: late ? 'atrasada' : 'pendente', due, next, today, locked: true };
}

// Histórico por dia de conferência (mais recente primeiro).
export function history({ now, start, deadline, counts, productDays, limit = 30 }) {
  const today = ymd(now);
  const due = latestDue(today, start);
  const rows = [];
  if (!due) return rows;
  for (let d = due, i = 0; d >= start && i < limit; d = addDays(d, -2), i++) {
    const until = addDays(d, 2); // a conferência vale até o próximo dia de conferência
    const done = counts
      .filter(c => c.date >= d && c.date < until)
      .sort((a, b) => a.at.localeCompare(b.at))[0];
    let state;
    if (!done && productDays && !productDays.some(x => x < d)) state = 'sem-cobranca';
    else if (done) state = done.date === d ? 'feita' : 'feita-atrasada';
    else if (d === due) state = countStatus({ now, start, deadline, counts: [], productCount: 1 }).state;
    else state = 'nao-feita';
    rows.push({ day: d, state, count: done || null });
  }
  return rows;
}
