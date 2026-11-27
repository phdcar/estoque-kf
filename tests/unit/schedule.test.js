import test from 'node:test';
import assert from 'node:assert/strict';
import { isCountDay, isWeekday, isCountWeekday, latestDue, nextDue, countStatus, history, missingDays, addDays } from '../../js/schedule.js';

// Desde a versão 0.8.3 a conferência é semanal, toda segunda-feira.
const S = '2026-11-23'; // segunda-feira
const at = (s) => new Date(s);
const c = (date, time = '10:00') => ({ id: date + time, date, at: `${date}T${time}:00.000Z`, by: 'Ana' });
const j = (date, days, text = 'Fiquei doente') => ({ id: 'j' + date, date, at: `${date}T09:00:00.000Z`, by: 'Ana', items: [], justification: text, days });
const PD = ['2026-11-20'];

test('dia de conferência: só segunda-feira', () => {
  assert.equal(isCountWeekday('2026-11-30'), true);   // segunda
  assert.equal(isCountWeekday('2026-11-27'), false);  // sexta
  assert.equal(isCountWeekday('2026-11-29'), false);  // domingo
  assert.equal(isWeekday('2026-11-27'), true);        // continua existindo (dias úteis)
  assert.equal(isCountDay('2026-11-30', S), true);
  assert.equal(isCountDay('2026-12-01', S), false);   // terça
  assert.equal(isCountDay('2026-11-16', S), false);   // antes do início
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('latestDue / nextDue', () => {
  assert.equal(latestDue('2026-11-23', S), '2026-11-23');
  assert.equal(latestDue('2026-11-27', S), '2026-11-23');   // sexta → segunda da semana
  assert.equal(latestDue('2026-11-20', S), null);
  assert.equal(nextDue('2026-11-23', S), '2026-11-30');     // segunda → próxima segunda
  assert.equal(nextDue('2026-11-27', S), '2026-11-30');
  assert.equal(nextDue('2026-11-10', S), S);
});

test('segunda-feira bloqueia até contar', () => {
  const base = { start: S, deadline: '18:00', productCount: 3, productDays: PD };
  let st = countStatus({ ...base, now: at('2026-11-30T09:00:00'), counts: [c('2026-11-23')] });
  assert.equal(st.state, 'pendente'); assert.equal(st.locked, true);
  st = countStatus({ ...base, now: at('2026-11-30T18:30:00'), counts: [c('2026-11-23')] });
  assert.equal(st.state, 'atrasada'); assert.equal(st.locked, true);
  st = countStatus({ ...base, now: at('2026-11-30T19:00:00'), counts: [c('2026-11-23'), c('2026-11-30')] });
  assert.equal(st.state, 'feita'); assert.equal(st.locked, false);
});

test('de terça a domingo não cobra conferência', () => {
  const base = { start: S, deadline: '18:00', productCount: 3, productDays: PD };
  for (const d of ['2026-11-24', '2026-11-26', '2026-11-28', '2026-11-29']) {
    const st = countStatus({ ...base, now: at(`${d}T19:00:00`), counts: [c('2026-11-23')] });
    assert.equal(st.state, 'fim-de-semana', d); assert.equal(st.locked, false, d);
    assert.equal(st.next, '2026-11-30');
  }
});

test('segunda-feira perdida exige justificativa', () => {
  const base = { start: S, deadline: '18:00', productCount: 3, productDays: PD };
  // segunda 30/11 não contou; na terça o app pede justificativa
  let st = countStatus({ ...base, now: at('2026-12-01T10:00:00'), counts: [c('2026-11-23')] });
  assert.deepEqual(st.missing, ['2026-11-30']); assert.equal(st.locked, true);
  // justificada: liberado
  st = countStatus({ ...base, now: at('2026-12-01T10:00:00'), counts: [c('2026-11-23'), j('2026-12-01', ['2026-11-30'])] });
  assert.deepEqual(st.missing, []); assert.equal(st.locked, false);
  // contar na segunda seguinte não dispensa a justificativa da anterior
  const st2 = countStatus({ ...base, now: at('2026-12-07T11:00:00'), counts: [c('2026-11-23'), c('2026-12-07')] });
  assert.deepEqual(st2.missing, ['2026-11-30']); assert.equal(st2.locked, true); assert.equal(st2.state, 'feita');
  // duas segundas perdidas
  const st3 = countStatus({ ...base, now: at('2026-12-08T10:00:00'), counts: [c('2026-11-23')] });
  assert.deepEqual(st3.missing, ['2026-11-30', '2026-12-07']);
});

test('não cobra antes de existir produto nem antes do início', () => {
  assert.equal(countStatus({ start: S, deadline: '18:00', productCount: 0, now: at('2026-11-30T09:00:00'), counts: [] }).locked, false);
  assert.equal(countStatus({ start: S, deadline: '18:00', productCount: 2, now: at('2026-11-20T09:00:00'), counts: [] }).state, 'nao-iniciada');
  const st = countStatus({ start: S, deadline: '18:00', productCount: 2, productDays: ['2026-11-30'], now: at('2026-11-30T09:00:00'), counts: [] });
  assert.equal(st.state, 'primeiro-dia'); assert.equal(st.locked, false); assert.deepEqual(st.missing, []);
  assert.deepEqual(missingDays({ now: at('2026-12-08T09:00:00'), start: S, counts: [], productDays: ['2026-11-26'] }), ['2026-11-30', '2026-12-07']);
});

test('histórico: uma linha por segunda-feira', () => {
  const rows = history({ now: at('2026-12-08T20:00:00'), start: S, deadline: '18:00', productDays: ['2026-11-20'],
    counts: [c('2026-11-23'), j('2026-12-01', ['2026-11-30'])] });
  assert.deepEqual(rows.map(r => [r.day, r.state]), [
    ['2026-12-07', 'nao-feita'], ['2026-11-30', 'justificada'], ['2026-11-23', 'feita'],
  ]);
  assert.equal(rows[1].justification.justification, 'Fiquei doente');
});

test('segundas-feiras sem conferência (aviso do radar)', async () => {
  const { sinceLastCount } = await import('../../js/schedule.js');
  const base = { deadline: '18:00' };
  assert.equal(sinceLastCount({ ...base, now: at('2026-11-26T09:00:00'), counts: [] }).days, null);
  assert.deepEqual(sinceLastCount({ ...base, now: at('2026-11-23T19:00:00'), counts: [c('2026-11-23')] }).days, 0);
  // contou segunda; na sexta: nada em atraso
  assert.equal(sinceLastCount({ ...base, now: at('2026-11-27T19:00:00'), counts: [c('2026-11-23')] }).days, 0);
  // segunda seguinte de manhã: pendente hoje, ainda sem atraso
  let s = sinceLastCount({ ...base, now: at('2026-11-30T09:00:00'), counts: [c('2026-11-23')] });
  assert.equal(s.days, 0); assert.equal(s.pendingToday, true);
  // segunda depois do prazo: 1
  assert.equal(sinceLastCount({ ...base, now: at('2026-11-30T18:30:00'), counts: [c('2026-11-23')] }).days, 1);
  // duas segundas perdidas
  assert.equal(sinceLastCount({ ...base, now: at('2026-12-08T10:00:00'), counts: [c('2026-11-23')] }).days, 2);
  // justificativa não conta como conferência
  assert.equal(sinceLastCount({ ...base, now: at('2026-12-01T10:00:00'), counts: [c('2026-11-23'), j('2026-12-01', ['2026-11-30'])] }).days, 1);
});
