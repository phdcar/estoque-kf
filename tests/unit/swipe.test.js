import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../../js/swipe.js';

test('deslizar: horizontal, longo e rápido conta', () => {
  assert.equal(classify(-120, 10, 300), 'left');
  assert.equal(classify(140, -20, 300), 'right');
});

test('deslizar: curto, vertical, diagonal ou lento não conta', () => {
  assert.equal(classify(-40, 0, 200), null);      // curto demais
  assert.equal(classify(30, 300, 300), null);     // rolagem vertical
  assert.equal(classify(100, 90, 300), null);     // diagonal
  assert.equal(classify(-150, 0, 2000), null);    // arrastar demorado
});
