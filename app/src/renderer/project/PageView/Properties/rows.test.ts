/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commit, draft, editable, keyless, shown, suggested } from './rows.ts';
import type { Open } from './rows.ts';

const owner = { key: 'Owner', value: 'Sal' };
const status = { key: 'Status', value: 'doing' };
const rows = [owner, status];

/** `row` opened, then its cells typed into. */
const opened = (row: { key: string; value: string }, typed: Partial<Open> = {}): Open => ({
  from: row,
  key: row.key,
  value: row.value,
  ...typed,
});

const writes = (...list: unknown[]) => ({ kind: 'writes', writes: list });

test('a draft writes its key, trimmed, and its value', () => {
  assert.deepEqual(
    commit(rows, { key: ' Due ', value: 'Friday' }),
    writes({ kind: 'set', key: 'Due', value: 'Friday' }),
  );
  assert.deepEqual(
    commit(rows, { key: 'Due', value: '' }),
    writes({ kind: 'set', key: 'Due', value: '' }),
  );
});

test('a draft with a blank key is dropped, whatever its value', () => {
  assert.deepEqual(commit(rows, draft()), writes());
  assert.deepEqual(commit(rows, { key: '   ', value: 'orphan' }), writes());
});

test('a draft onto a key the page has is refused, in any spelling', () => {
  assert.deepEqual(commit(rows, { key: ' status ', value: 'x' }), { kind: 'taken' });
});

test('a written row left as it was opened writes nothing', () => {
  assert.deepEqual(commit(rows, opened(owner)), writes());
});

test('clearing a key and leaving puts the row back, even with its value cleared too', () => {
  assert.deepEqual(commit(rows, opened(owner, { key: '' })), writes());
  assert.deepEqual(commit(rows, opened(owner, { key: '', value: '' })), writes());
});

test('a changed value is written under the key as drawn', () => {
  assert.deepEqual(
    commit(rows, opened(status, { value: 'done' })),
    writes({ kind: 'set', key: 'Status', value: 'done' }),
  );
  assert.deepEqual(
    commit(rows, opened(status, { value: '' })),
    writes({ kind: 'set', key: 'Status', value: '' }),
  );
});

test('retyping a key in another case is no rename', () => {
  assert.deepEqual(commit(rows, opened(owner, { key: 'OWNER ' })), writes());
  assert.deepEqual(
    commit(rows, opened(owner, { key: 'owner', value: 'Kim' })),
    writes({ kind: 'set', key: 'Owner', value: 'Kim' }),
  );
});

test('a new key is a rename, and a changed value is written after it', () => {
  assert.deepEqual(
    commit(rows, opened(owner, { key: 'Author' })),
    writes({ kind: 'rename', from: 'Owner', to: 'Author', value: 'Sal' }),
  );
  assert.deepEqual(
    commit(rows, opened(owner, { key: 'Author', value: 'Kim' })),
    writes(
      { kind: 'rename', from: 'Owner', to: 'Author', value: 'Sal' },
      { kind: 'set', key: 'Author', value: 'Kim' },
    ),
  );
});

test('a rename onto another row is refused', () => {
  assert.deepEqual(commit(rows, opened(owner, { key: 'status' })), { kind: 'taken' });
});

test('a value another writer changed while the row was open is not written back', () => {
  const now = [owner, { key: 'Status', value: 'blocked' }];
  assert.deepEqual(commit(now, opened(status)), writes());
  assert.deepEqual(
    commit(now, opened(status, { key: 'State' })),
    writes({ kind: 'rename', from: 'Status', to: 'State', value: 'blocked' }),
  );
});

test('a row another writer removed while it was open is written again only if it was changed', () => {
  const now = [status];
  assert.deepEqual(commit(now, opened(owner)), writes());
  assert.deepEqual(
    commit(now, opened(owner, { value: 'Kim' })),
    writes({ kind: 'set', key: 'Owner', value: 'Kim' }),
  );
  assert.deepEqual(
    commit(now, opened(owner, { key: 'Author' })),
    writes({ kind: 'set', key: 'Author', value: 'Sal' }),
  );
});

test('a row removed while open stays drawn where it was, a draft is not drawn among them', () => {
  const now = [status];
  assert.deepEqual(shown(now, opened(owner)), [owner, status]);
  assert.deepEqual(shown(rows, opened(owner)), rows);
  assert.deepEqual(shown(rows, draft()), rows);
  assert.deepEqual(shown(rows, null), rows);
});

test('only a keyless draft is keyless', () => {
  assert.equal(keyless(draft()), true);
  assert.equal(keyless({ key: ' ', value: 'x' }), true);
  assert.equal(keyless({ key: 'Due', value: '' }), false);
  assert.equal(keyless(opened(owner, { key: '' })), false);
});

test('a value with a newline is not edited in a one-line cell', () => {
  assert.equal(editable('one line'), true);
  assert.equal(editable(''), true);
  assert.equal(editable('two\nlines'), false);
});

test('a key is offered titles that are not typed already and not another row\'s', () => {
  const found = ['Owner', 'Status', 'Stage', 'Due'];
  assert.deepEqual(suggested(found, rows, { key: 'due', value: '' }), ['Stage']);
  assert.deepEqual(suggested(found, rows, opened(owner, { key: 'O' })), ['Owner', 'Stage', 'Due']);
});
