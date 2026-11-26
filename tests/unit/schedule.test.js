import test from 'node:test';
import assert from 'node:assert/strict';
import { isCountDay, latestDue, nextDue, countStatus, history, addDays, diffDays } from '../../js/schedule.js';

const S = '2026-11-26';
const at = (s) => new Date(s);
const c = (date, time = '10:00') => ({ id: date + time, date, at: `${date}T${time}:00.000Z`, by: 'Ana' });

test('dias de conferência alternados', () => {
  assert.equal(isCountDay('2026-11-26', S), true);
  assert.equal(isCountDay('2026-11-27', S), false);
  assert.equal(isCountDay('2026-11-28', S), true);
  assert.equal(isCountDay('2026-11-25', S), false);
  // virada de mês e de ano
  assert.equal(isCountDay('2026-12-02', S), true);
  assert.equal(isCountDay('2027-01-01', S), diffDays(S, '2027-01-01') % 2 === 0);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('latestDue / nextDue', () => {
  assert.equal(latestDue('2026-11-26', S), '2026-11-26');
  assert.equal(latestDue('2026-11-27', S), '2026-11-26');
  assert.equal(latestDue('2026-11-25', S), null);
  assert.equal(nextDue('2026-11-26', S), '2026-11-28');
  assert.equal(nextDue('2026-11-27', S), '2026-11-28');
  assert.equal(nextDue('2026-11-20', S), S);
});

test('bloqueia no dia de conferência até contar', () => {
  const base = { start: S, deadline: '18:00', productCount: 3 };
  let st = countStatus({ ...base, now: at('2026-11-26T09:00:00'), counts: [] });
  assert.equal(st.state, 'pendente'); assert.equal(st.locked, true);
  st = countStatus({ ...base, now: at('2026-11-26T18:30:00'), counts: [] });
  assert.equal(st.state, 'atrasada'); assert.equal(st.locked, true);
  st = countStatus({ ...base, now: at('2026-11-26T19:00:00'), counts: [c('2026-11-26')] });
  assert.equal(st.state, 'feita'); assert.equal(st.locked, false);
  // dia seguinte (não é dia de conferência), já feita ontem: livre
  st = countStatus({ ...base, now: at('2026-11-27T09:00:00'), counts: [c('2026-11-26')] });
  assert.equal(st.state, 'feita'); assert.equal(st.locked, false);
  // dia seguinte, ontem não foi feita: atrasada e bloqueado
  st = countStatus({ ...base, now: at('2026-11-27T09:00:00'), counts: [] });
  assert.equal(st.state, 'atrasada'); assert.equal(st.locked, true);
  // feita com atraso no dia seguinte libera
  st = countStatus({ ...base, now: at('2026-11-27T11:00:00'), counts: [c('2026-11-27')] });
  assert.equal(st.state, 'feita');
  // mas não cobre o próximo dia de conferência
  st = countStatus({ ...base, now: at('2026-11-28T08:00:00'), counts: [c('2026-11-27')] });
  assert.equal(st.state, 'pendente'); assert.equal(st.locked, true);
  // contagem antiga não libera
  st = countStatus({ ...base, now: at('2026-11-28T08:00:00'), counts: [c('2026-11-26')] });
  assert.equal(st.locked, true);
});

test('sem produtos ou antes do início não bloqueia', () => {
  assert.equal(countStatus({ start: S, deadline: '18:00', productCount: 0, now: at('2026-11-26T09:00:00'), counts: [] }).locked, false);
  assert.equal(countStatus({ start: S, deadline: '18:00', productCount: 2, now: at('2026-11-25T09:00:00'), counts: [] }).state, 'nao-iniciada');
});

test('histórico mostra quem conferiu e dias perdidos', () => {
  const rows = history({ now: at('2026-12-02T20:00:00'), start: S, deadline: '18:00',
    counts: [c('2026-11-26'), c('2026-11-29'), c('2026-12-02')] });
  assert.deepEqual(rows.map(r => [r.day, r.state]), [
    ['2026-12-02', 'feita'], ['2026-11-30', 'nao-feita'], ['2026-11-28', 'feita-atrasada'], ['2026-11-26', 'feita'],
  ]);
  const r2 = history({ now: at('2026-12-02T20:00:00'), start: S, deadline: '18:00', counts: [] });
  assert.equal(r2[0].state, 'atrasada');
});

test('produtos cadastrados no próprio dia de conferência não bloqueiam', () => {
  const base = { start: S, deadline: '18:00', counts: [], productCount: 2 };
  let st = countStatus({ ...base, now: at('2026-11-26T09:00:00'), productDays: ['2026-11-26', '2026-11-26'] });
  assert.equal(st.state, 'primeiro-dia'); assert.equal(st.locked, false);
  st = countStatus({ ...base, now: at('2026-11-28T09:00:00'), productDays: ['2026-11-26', '2026-11-28'] });
  assert.equal(st.locked, true);
});

test('histórico não cobra dias antes de existir produto', () => {
  const rows = history({ now: at('2026-11-28T20:00:00'), start: S, deadline: '18:00', counts: [c('2026-11-28')], productDays: ['2026-11-26'] });
  assert.deepEqual(rows.map(r => r.state), ['feita', 'sem-cobranca']);
});
