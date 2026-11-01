/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Place, PlaceView } from '../../../shared/pages.ts';
import type { Held } from '../held/held.ts';
import { createFetcher } from './fetcher.ts';

/** A fetch the test answers by hand. */
type Asked = {
  place: Place | undefined;
  answer: (version: number) => Promise<void>;
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
    view: (place) =>
      new Promise<PlaceView>((resolve, reject) => {
        asked.push({
          place,
          answer: (version) => {
            resolve({ version, showing: [], previews: [] });
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
