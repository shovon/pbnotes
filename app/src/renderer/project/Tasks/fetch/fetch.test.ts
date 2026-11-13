/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPEN_TASKS } from '../../../../shared/graph.ts';
import type { Filter, TaskView } from '../../../../shared/graph.ts';
import { createTaskFetcher } from './fetch.ts';

/** A fetch the test answers by hand. */
type Asked = {
  filter: Filter;
  through: string | undefined;
  answer: (version: number, list?: TaskView['list']) => Promise<void>;
  fail: (error: unknown) => Promise<void>;
};

/** Lets the fetcher's `then` run. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

const setup = () => {
  let on: Filter = OPEN_TASKS;
  const asked: Asked[] = [];
  const answers: TaskView[] = [];
  const errors: unknown[] = [];
  const fetcher = createTaskFetcher({
    tasks: (filter, through) =>
      new Promise<TaskView>((resolve, reject) => {
        asked.push({
          filter,
          through,
          answer: (version, list = { through: null, next: null }) => {
            resolve({ version, pages: [], shown: 0, total: 0, previews: [], list });
            return settle();
          },
          fail: (error) => {
            reject(error);
            return settle();
          },
        });
      }),
    filter: () => on,
    onAnswer: (view) => answers.push(view),
    onError: (error) => errors.push(error),
  });
  const pick = (filter: Filter) => {
    on = filter;
    fetcher.moved();
  };
  return { fetcher, asked, answers, errors, pick };
};

test('opening asks for the filter the view is on, and draws the answer', async () => {
  const { fetcher, asked, answers } = setup();
  fetcher.moved();
  assert.deepEqual(asked.map((it) => [it.filter, it.through]), [[OPEN_TASKS, undefined]]);
  await asked[0].answer(3);
  assert.deepEqual(answers.map((it) => it.version), [3]);
});

test('a change the answer already holds asks nothing; a newer one asks again', async () => {
  const { fetcher, asked } = setup();
  fetcher.moved();
  await asked[0].answer(3);
  fetcher.heard(3);
  assert.equal(asked.length, 1);
  fetcher.heard(4);
  assert.equal(asked.length, 2);
});

test('a change a fetch on its way covers asks nothing more', () => {
  const { fetcher, asked } = setup();
  fetcher.heard(4);
  fetcher.moved();
  fetcher.heard(4);
  assert.equal(asked.length, 2);
});

test('an answer for a filter the view has left is never drawn', async () => {
  const { fetcher, asked, answers, pick } = setup();
  fetcher.moved();
  pick([]);
  await asked[1].answer(5);
  await asked[0].answer(6);
  assert.deepEqual(answers.map((it) => it.version), [5]);
});

test('an answer older than the one drawn is dropped', async () => {
  const { fetcher, asked, answers } = setup();
  fetcher.moved();
  fetcher.heard(5);
  await asked[1].answer(5);
  await asked[0].answer(3);
  assert.deepEqual(answers.map((it) => it.version), [5]);
});

test('main picks how far the first chunk goes, and the fetcher keeps asking for it', async () => {
  const { fetcher, asked } = setup();
  fetcher.moved();
  await asked[0].answer(3, { through: 'Kitchen', next: 'Zebra' });
  fetcher.heard(4);
  assert.equal(asked[1].through, 'Kitchen');
});

test('more asks for the chunk main named, once', async () => {
  const { fetcher, asked } = setup();
  fetcher.moved();
  await asked[0].answer(3, { through: 'Kitchen', next: 'Zebra' });
  fetcher.more();
  fetcher.more();
  assert.deepEqual(asked.map((it) => it.through), [undefined, 'Zebra']);
});

test('nothing more to load asks nothing', async () => {
  const { fetcher, asked } = setup();
  fetcher.moved();
  await asked[0].answer(3);
  fetcher.more();
  assert.equal(asked.length, 1);
});

test('a new filter starts over at the first chunk', async () => {
  const { fetcher, asked, pick } = setup();
  fetcher.moved();
  await asked[0].answer(3, { through: 'Kitchen', next: 'Zebra' });
  fetcher.more();
  pick([]);
  assert.equal(asked[2].through, undefined);
});

test('a failed fetch is reported, and the next change asks again', async () => {
  const { fetcher, asked, errors } = setup();
  fetcher.moved();
  await asked[0].fail(new Error('gone'));
  assert.equal(errors.length, 1);
  fetcher.heard(2);
  assert.equal(asked.length, 2);
});
