/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Place, PlaceView } from '../../../shared/graph.ts';
import type { Held } from '../held/held.ts';
import { createFetcher } from './fetcher.ts';

/** A fetch the test answers by hand. */
type Asked = {
  place: Place | undefined;
  /** Where the journal was asked from: undefined for main's newest days. */
  from: string | undefined;
  /** Answers at `version`, on the journal with `journal` as its window. */
  answer: (version: number, journal?: PlaceView['journal']) => Promise<void>;
  fail: (error: unknown) => Promise<void>;
};

/** Lets the fetcher's `then` run. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

const setup = (start?: Place) => {
  let on = start;
  const asked: Asked[] = [];
  const answers: Held[] = [];
  const errors: unknown[] = [];
  const fetcher = createFetcher({
    view: (place, from) =>
      new Promise<PlaceView>((resolve, reject) => {
        asked.push({
          place,
          from,
          answer: (version, journal) => {
            resolve({ version, showing: [], previews: [], ...(journal ? { journal } : {}) });
            return settle();
          },
          fail: (error) => {
            reject(error);
            return settle();
          },
        });
      }),
    where: () => on,
    onAnswer: (held) => answers.push(held),
    onError: (error) => errors.push(error),
  });
  const go = (place: Place | undefined) => {
    on = place;
    fetcher.moved();
  };
  return { fetcher, asked, answers, errors, go };
};

const mira = { page: 'Mira' };

test('opening fetches for the place the window is on, and holds the answer', async () => {
  const { fetcher, asked, answers } = setup();
  fetcher.moved();
  assert.equal(asked.length, 1);
  await asked[0].answer(3);
  assert.deepEqual(answers.map((it) => it.view.version), [3]);
});

test('a notice for a version the view held already has does not fetch', async () => {
  const { fetcher, asked } = setup();
  fetcher.moved();
  await asked[0].answer(5);
  fetcher.heard(5);
  fetcher.heard(4);
  assert.equal(asked.length, 1);
});

test('a reply naming a newer version, with no fetch on its way, fetches once', async () => {
  const { fetcher, asked, answers } = setup();
  fetcher.moved();
  await asked[0].answer(5);
  fetcher.heard(6);
  assert.equal(asked.length, 2);
  await asked[1].answer(6);
  assert.deepEqual(answers.map((it) => it.view.version), [5, 6]);
});

test('two notices close together fetch once', async () => {
  const { fetcher, asked } = setup();
  fetcher.moved();
  await asked[0].answer(5);
  fetcher.heard(6);
  fetcher.heard(6);
  assert.equal(asked.length, 2);
});

test('a notice and a reply for the same version fetch once', async () => {
  const { fetcher, asked } = setup();
  fetcher.moved();
  await asked[0].answer(5);
  fetcher.heard(6); // the notice
  fetcher.heard(6); // the write's reply
  await asked[1].answer(6);
  fetcher.heard(6); // a late copy of either
  assert.equal(asked.length, 2);
});

test('a version heard after a fetch went out fetches again', async () => {
  const { fetcher, asked } = setup();
  fetcher.moved();
  await asked[0].answer(5);
  fetcher.heard(6);
  fetcher.heard(7);
  assert.equal(asked.length, 3);
});

test('a step fetches for the new place, and a late answer for the old place is not held', async () => {
  const { fetcher, asked, answers, go } = setup();
  fetcher.moved();
  go(mira);
  assert.deepEqual(asked.map((it) => it.place), [undefined, mira]);
  await asked[1].answer(4);
  await asked[0].answer(9);
  assert.deepEqual(answers, [{ place: mira, view: { version: 4, showing: [], previews: [] } }]);
});

test('an older answer arriving after a newer one for the same place is not held', async () => {
  const { fetcher, asked, answers } = setup();
  fetcher.moved();
  await asked[0].answer(5);
  fetcher.heard(6);
  fetcher.heard(7);
  await asked[2].answer(7);
  await asked[1].answer(6);
  assert.deepEqual(answers.map((it) => it.view.version), [5, 7]);
});

test('a view held for the old place says nothing about the new one, but the step’s fetch does', async () => {
  const { fetcher, asked, go } = setup();
  fetcher.moved();
  await asked[0].answer(5);
  fetcher.heard(5); // held already
  go(mira); // its answer never comes
  // The journal's view is not Mira's, but the step's fetch went out after
  // 5 was heard of, so it covers 5. Not 6.
  fetcher.heard(5);
  assert.equal(asked.length, 2);
  fetcher.heard(6);
  assert.equal(asked.length, 3);
});

test('a failed fetch is reported, and the next notice fetches again', async () => {
  const { fetcher, asked, errors } = setup();
  fetcher.moved();
  await asked[0].answer(5);
  fetcher.heard(6);
  const error = new Error('unreachable');
  await asked[1].fail(error);
  assert.deepEqual(errors, [error]);
  fetcher.heard(6);
  assert.equal(asked.length, 3);
});

test('the journal asks from where main first said, every time after (#282)', async () => {
  const { fetcher, asked } = setup();
  fetcher.moved();
  await asked[0].answer(5, { from: '2026-09-10', next: '2026-08-30' });
  fetcher.heard(6);
  assert.deepEqual(asked.map((it) => it.from), [undefined, '2026-09-10']);
});

test('more asks from the next older days once, and holds the wider journal (#282)', async () => {
  const { fetcher, asked, answers } = setup();
  fetcher.moved();
  await asked[0].answer(5, { from: '2026-09-10', next: '2026-08-30' });
  fetcher.more();
  fetcher.more(); // the marker seen again before the answer
  assert.deepEqual(asked.map((it) => it.from), [undefined, '2026-08-30']);
  await asked[1].answer(5, { from: '2026-08-30', next: null });
  assert.deepEqual(answers.map((it) => it.view.journal?.from), ['2026-09-10', '2026-08-30']);
  fetcher.more(); // nothing older
  fetcher.heard(6);
  assert.deepEqual(asked.map((it) => it.from), [undefined, '2026-08-30', '2026-08-30']);
});

test('a journal read for the window before more is not held, even when it lands last (#282)', async () => {
  const { fetcher, asked, answers } = setup();
  fetcher.moved();
  await asked[0].answer(5, { from: '2026-09-10', next: '2026-08-30' });
  fetcher.heard(6); // asks from 09-10
  fetcher.more(); // asks from 08-30
  await asked[2].answer(6, { from: '2026-08-30', next: null });
  await asked[1].answer(6, { from: '2026-09-10', next: '2026-08-30' });
  assert.deepEqual(answers.map((it) => it.view.journal?.from), ['2026-09-10', '2026-08-30']);
  assert.equal(asked.length, 3, "the wider one held it already: nothing asked again");
});

test('a second first answer, newer than the one held, is asked for again over the window held (#282)', async () => {
  const { fetcher, asked, answers } = setup();
  fetcher.moved();
  fetcher.heard(6); // before any answer: a second fetch from main's newest days
  await asked[0].answer(5, { from: '2026-09-10', next: null });
  // A day arrived between the two, so main's newest days start later.
  await asked[1].answer(6, { from: '2026-09-11', next: '2026-09-10' });
  assert.deepEqual(asked.map((it) => it.from), [undefined, undefined, '2026-09-10']);
  await asked[2].answer(6, { from: '2026-09-10', next: null });
  assert.deepEqual(answers.map((it) => [it.view.version, it.view.journal?.from]), [
    [5, '2026-09-10'],
    [6, '2026-09-10'],
  ]);
});

test('more does nothing on a page, and the journal starts over after one (#282)', async () => {
  const { fetcher, asked, go } = setup();
  fetcher.moved();
  await asked[0].answer(5, { from: '2026-09-10', next: '2026-08-30' });
  fetcher.more();
  await asked[1].answer(5, { from: '2026-08-30', next: '2026-08-01' });
  go(mira);
  fetcher.more();
  await asked[2].answer(5);
  go(undefined);
  assert.deepEqual(asked.map((it) => [it.place, it.from]), [
    [undefined, undefined],
    [undefined, '2026-08-30'],
    [mira, undefined],
    [undefined, undefined],
  ]);
});
