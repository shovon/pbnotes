/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keptOnBench, sidebarKept, titles } from './kept.ts';

// Composition root for these tests: a bench that keeps slots in a Map, can be
// told to fail, and can hold a read until the test lets it go.

function fakeBench() {
  const slots = new Map<string, unknown>();
  const sets: [string, unknown][] = [];
  let failing = false;
  let gate: Promise<void> | undefined;
  let open = () => undefined as void;
  return {
    slots,
    sets,
    fail: () => {
      failing = true;
    },
    /** Reads wait until `release`. */
    hold: () => {
      gate = new Promise<void>((resolve) => {
        open = resolve;
      });
    },
    release: () => open(),
    get: async (slot: string): Promise<unknown> => {
      if (failing) throw new Error('bench down');
      if (gate) await gate;
      return slots.get(slot);
    },
    set: async (slot: string, value: unknown): Promise<void> => {
      if (failing) throw new Error('bench down');
      sets.push([slot, value]);
      slots.set(slot, value);
    },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('loads what passes the check', async () => {
  const bench = fakeBench();
  bench.slots.set('s', ['Mira']);
  const { kept } = keptOnBench(bench, 's', titles, () => undefined);
  assert.deepEqual(await kept.load(), ['Mira']);
});

test("loads undefined for what doesn't pass, or for nothing kept", async () => {
  const bench = fakeBench();
  const { kept } = keptOnBench(bench, 's', titles, () => undefined);
  assert.equal(await kept.load(), undefined);
  bench.slots.set('s', [1, 2]);
  assert.equal(await kept.load(), undefined);
});

test('saves to its slot', async () => {
  const bench = fakeBench();
  const { kept } = keptOnBench(bench, 's', titles, () => undefined);
  kept.save(['Mira']);
  await settle();
  assert.deepEqual(bench.sets, [['s', ['Mira']]]);
});

test('turned off, it saves nothing and loads undefined', async () => {
  const bench = fakeBench();
  bench.slots.set('s', ['Mira']);
  const { kept, off } = keptOnBench(bench, 's', titles, () => undefined);
  off();
  kept.save(['Bar']);
  await settle();
  assert.deepEqual(bench.sets, []);
  assert.equal(await kept.load(), undefined);
});

test('a load that answers after it was turned off gives undefined', async () => {
  const bench = fakeBench();
  bench.slots.set('s', ['Mira']);
  bench.hold();
  const { kept, off } = keptOnBench(bench, 's', titles, () => undefined);
  const loading = kept.load();
  await settle();
  off();
  bench.release();
  assert.equal(await loading, undefined);
});

test('a failure is reported, and a load that fails gives undefined', async () => {
  const bench = fakeBench();
  bench.fail();
  const reported: unknown[] = [];
  const { kept } = keptOnBench(bench, 's', titles, (error) => reported.push(error));
  assert.equal(await kept.load(), undefined);
  kept.save(['Mira']);
  await settle();
  assert.equal(reported.length, 2);
});

test("the sidebar's three values, under their slots, off together", async () => {
  const bench = fakeBench();
  const kept = sidebarKept(bench, () => undefined);
  kept.recentPages.save(['Mira']);
  kept.sidebar.save({ collapsed: true });
  kept.recentSection.save({ collapsed: true });
  await settle();
  assert.deepEqual(bench.sets, [
    ['recent-pages', ['Mira']],
    ['sidebar', { collapsed: true }],
    ['recent-section', { collapsed: true }],
  ]);
  kept.off();
  kept.recentPages.save(['Bar']);
  kept.recentSection.save({ collapsed: false });
  await settle();
  assert.equal(bench.sets.length, 3);
});
