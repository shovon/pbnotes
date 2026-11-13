/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adding, drawn, refusal, told } from './adding.ts';

test('nothing typed, once trimmed, is blank', () => {
  assert.deepEqual(adding(['JS'], 'JavaScript', ''), { kind: 'blank' });
  assert.deepEqual(adding(['JS'], 'JavaScript', '   '), { kind: 'blank' });
});

test("the page's own title and a YYYY-MM-DD are refused", () => {
  assert.deepEqual(adding([], 'JavaScript', ' javascript '), { kind: 'self' });
  assert.deepEqual(adding([], 'JavaScript', '2024-11-04'), { kind: 'date' });
});

test('an alias the page has is held, in any case or spacing, and names the chip as drawn', () => {
  assert.deepEqual(adding(['JS', 'ECMAScript'], 'JavaScript', ' js'), { kind: 'held', alias: 'JS' });
});

test('anything else is added, trimmed', () => {
  assert.deepEqual(adding(['JS'], 'JavaScript', '  ES6 '), { kind: 'add', alias: 'ES6' });
  assert.deepEqual(adding([], 'JavaScript', 'Nov 4th, 2024'), { kind: 'add', alias: 'Nov 4th, 2024' });
});

test('each reason an alias is inert has its words', () => {
  assert.equal(told('JS', { why: 'own' }), 'JS has notes of its own, so it opens itself');
  assert.equal(told('JS', { why: 'aliases' }), 'JS has aliases of its own, so it opens itself');
  assert.equal(told('JS', { why: 'claimed', by: 'Python' }), 'Python also claims JS, and opens it');
  assert.equal(told('Nov 4th, 2024', { why: 'day', day: '2024-11-04' }), 'Nov 4th, 2024 is a date, so it opens 2024-11-04');
  assert.equal(refusal('self', 'javascript'), 'This page is already called javascript');
});

test('the chips drawn keep what main said about each, and a new one is drawn in effect', () => {
  assert.deepEqual(drawn(['ES6', 'js'], [{ alias: 'JS', inert: { why: 'own' } }, { alias: 'Jay' }]), [
    { alias: 'ES6' },
    { alias: 'js', inert: { why: 'own' } },
  ]);
});
