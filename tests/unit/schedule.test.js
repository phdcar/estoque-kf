import test from 'node:test';
import assert from 'node:assert/strict';
import { isCountDay, isWeekday, latestDue, nextDue, countStatus, history, missingDays, addDays } from '../../js/schedule.js';

const S = '2026-11-23'; // segunda-feira
const at = (s) => new Date(s);
const c = (date, time = '10:00') => ({ id: date + time, date, at: `${date}T${time}:00.000Z`, by: 'Ana' });
const j = (date, days, text = 'Fiquei doente') => ({ id: 'j' + date, date, at: `${date}T09:00:00.000Z`, by: 'Ana', items: [], justification: text, days });
const PD = ['2026-11-20'];

test('dias úteis: segunda a sexta', () => {
  assert.equal(isWeekday('2026-11-27'), true);   // sexta
  assert.equal(isWeekday('2026-11-28'), false);  // sábado
  assert.equal(isWeekday('2026-11-29'), false);  // domingo
  assert.equal(isCountDay('2026-11-30', S), true);
  assert.equal(isCountDay('2026-11-20', S), false); // antes do início
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('latestDue / nextDue', () => {
  assert.equal(latestDue('2026-11-26', S), '2026-11-26');
  assert.equal(latestDue('2026-11-29', S), '2026-11-27');   // domingo → sexta
  assert.equal(latestDue('2026-11-20', S), null);
  assert.equal(nextDue('2026-11-26', S), '2026-11-27');
  assert.equal(nextDue('2026-11-27', S), '2026-11-30');     // sexta → segunda
  assert.equal(nextDue('2026-11-10', S), S);
});

test('bloqueia todo dia útil até contar', () => {
  const base = { start: S, deadline: '18:00', productCount: 3, productDays: PD };
  const ok = ['2026-11-23', '2026-11-24', '2026-11-25'].map(d => c(d));
  let st = countStatus({ ...base, now: at('2026-11-26T09:00:00'), counts: ok });
  assert.equal(st.state, 'pendente'); assert.equal(st.locked, true);
  st = countStatus({ ...base, now: at('2026-11-26T18:30:00'), counts: ok });
  assert.equal(st.state, 'atrasada'); assert.equal(st.locked, true);
  st = countStatus({ ...base, now: at('2026-11-26T19:00:00'), counts: [...ok, c('2026-11-26')] });
  assert.equal(st.state, 'feita'); assert.equal(st.locked, false);
});

test('fim de semana não cobra conferência', () => {
  const base = { start: S, deadline: '18:00', productCount: 3, productDays: PD };
  const week = ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27'].map(d => c(d));
  const st = countStatus({ ...base, now: at('2026-11-28T10:00:00'), counts: week });
  assert.equal(st.state, 'fim-de-semana'); assert.equal(st.locked, false);
  assert.equal(st.next, '2026-11-30');
});

test('dia útil perdido exige justificativa', () => {
  const base = { start: S, deadline: '18:00', productCount: 3, productDays: PD };
  // sexta não contou; no sábado o app pede justificativa
  const week = ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26'].map(d => c(d));
  let st = countStatus({ ...base, now: at('2026-11-28T10:00:00'), counts: week });
  assert.deepEqual(st.missing, ['2026-11-27']); assert.equal(st.locked, true);
  // justificada: liberado
  st = countStatus({ ...base, now: at('2026-11-28T10:00:00'), counts: [...week, j('2026-11-28', ['2026-11-27'])] });
  assert.deepEqual(st.missing, []); assert.equal(st.locked, false);
  // contar hoje não dispensa a justificativa de ontem
  const st2 = countStatus({ ...base, now: at('2026-11-25T11:00:00'), counts: [c('2026-11-23'), c('2026-11-25')] });
  assert.deepEqual(st2.missing, ['2026-11-24']); assert.equal(st2.locked, true); assert.equal(st2.state, 'feita');
});

test('não cobra antes de existir produto nem antes do início', () => {
  assert.equal(countStatus({ start: S, deadline: '18:00', productCount: 0, now: at('2026-11-26T09:00:00'), counts: [] }).locked, false);
  assert.equal(countStatus({ start: S, deadline: '18:00', productCount: 2, now: at('2026-11-20T09:00:00'), counts: [] }).state, 'nao-iniciada');
  const st = countStatus({ start: S, deadline: '18:00', productCount: 2, productDays: ['2026-11-26'], now: at('2026-11-26T09:00:00'), counts: [] });
  assert.equal(st.state, 'primeiro-dia'); assert.equal(st.locked, false); assert.deepEqual(st.missing, []);
  assert.deepEqual(missingDays({ now: at('2026-11-30T09:00:00'), start: S, counts: [], productDays: ['2026-11-26'] }), ['2026-11-27']);
});

test('histórico: feita, justificada, não feita, sem cobrança; pula fim de semana', () => {
  const rows = history({ now: at('2026-12-01T20:00:00'), start: S, deadline: '18:00', productDays: ['2026-11-24'],
    counts: [c('2026-11-25'), j('2026-11-30', ['2026-11-26']), c('2026-12-01')] });
  assert.deepEqual(rows.map(r => [r.day, r.state]), [
    ['2026-12-01', 'feita'], ['2026-11-30', 'nao-feita'], ['2026-11-27', 'nao-feita'], ['2026-11-26', 'justificada'],
    ['2026-11-25', 'feita'], ['2026-11-24', 'sem-cobranca'], ['2026-11-23', 'sem-cobranca'],
  ]);
  assert.equal(rows[3].justification.justification, 'Fiquei doente');
});
