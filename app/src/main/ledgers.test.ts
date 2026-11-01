/**
 * Run with: npm test
 *
 * How often the open ledgers read their folders: at the focused pace while a
 * window has focus, at the background pace while none does, and in full the
 * moment one gains it. A write from another session is what shows it, since
 * only a scan finds that.
 */
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { Cadence, Event, Fold } from "@pbnotes/ledger";
import * as pages from "@pbnotes/pages";
import { createLedgers } from "./ledgers.ts";
import type { LedgerPort, LedgerRef, Ledgers, Paces } from "./ledgers.ts";

/** This test's ledgers, closed when it ends, pass or fail, so no timer outlives it. */
function make(t: TestContext, paces: Paces): Ledgers {
  const ledgers = createLedgers(paces);
  t.after(() => ledgers.close());
  return ledgers;
}

/** Never scans in a test's lifetime, so only a refresh finds anything. */
const NEVER: Cadence = { everyMs: 60_000, quietAfterMs: 60_000, quietEveryMs: 60_000 };
const OFTEN: Cadence = { everyMs: 20, quietAfterMs: 60_000, quietEveryMs: 60_000 };
/** Long enough for ten scans at `OFTEN`. */
const A_WHILE = 200;

async function project(): Promise<LedgerRef> {
  return { id: randomUUID(), path: await mkdtemp(path.join(tmpdir(), "pbnotes-project-")) };
}

/** Another session on the same folder: its own ledger, so its own writer directory. */
async function writeFromElsewhere(project: LedgerRef, text: string): Promise<void> {
  const other = createLedgers();
  try {
    await pages.addBlock(await other.pagesOf(project), "Elsewhere", text, undefined, randomUUID());
  } finally {
    await other.close();
  }
}

/** Counts each time `project`'s pages are announced as having moved. */
function listen(ledgers: Ledgers, project: LedgerRef): { count: number } {
  const heard = { count: 0 };
  ledgers.onChange((id) => {
    if (id === project.id) heard.count++;
  });
  return heard;
}

async function until(ok: () => boolean): Promise<void> {
  while (!ok()) await sleep(5);
}

test("gaining focus reads the folder on screen at once", { timeout: 5000 }, async (t) => {
  const ledgers = make(t, { focused: NEVER, background: NEVER });
  const p = await project();
  await ledgers.pagesOf(p);
  const heard = listen(ledgers, p);

  await writeFromElsewhere(p, "one");
  await sleep(A_WHILE);
  assert.equal(heard.count, 0, "no scan ran by itself");

  ledgers.setFocused(true, p.id);
  await until(() => heard.count === 1);
});

test("gaining focus reads only the project on screen in full", { timeout: 5000 }, async (t) => {
  const ledgers = make(t, { focused: NEVER, background: NEVER });
  const [shown, hidden] = [await project(), await project()];
  await ledgers.pagesOf(shown);
  await ledgers.pagesOf(hidden);
  const moved: string[] = [];
  ledgers.onChange((id) => moved.push(id));

  await writeFromElsewhere(shown, "on screen");
  await writeFromElsewhere(hidden, "kept open, not shown");
  ledgers.setFocused(true, shown.id);
  await until(() => moved.includes(shown.id));
  await sleep(A_WHILE);
  assert.deepEqual(moved, [shown.id], "the hidden project was not read");
});

test("losing focus slows the reads, and gaining it brings them back", { timeout: 5000 }, async (t) => {
  const ledgers = make(t, { focused: OFTEN, background: NEVER });
  const p = await project();
  await ledgers.pagesOf(p);
  const heard = listen(ledgers, p);

  await writeFromElsewhere(p, "focused");
  await until(() => heard.count === 1);

  ledgers.setFocused(false);
  await sleep(50); // a scan already under way may still see what comes next
  await writeFromElsewhere(p, "in the background");
  await sleep(A_WHILE);
  assert.equal(heard.count, 1, "not read at the background pace yet");

  ledgers.setFocused(true, p.id);
  await until(() => heard.count === 2);
  await writeFromElsewhere(p, "focused again");
  await until(() => heard.count === 3);
});

test("a ledger opened in the background opens at the background pace", { timeout: 5000 }, async (t) => {
  const ledgers = make(t, { focused: OFTEN, background: NEVER });
  ledgers.setFocused(false);
  const p = await project();
  await ledgers.pagesOf(p);
  const heard = listen(ledgers, p);

  await writeFromElsewhere(p, "one");
  await sleep(A_WHILE);
  assert.equal(heard.count, 0);

  ledgers.setFocused(true, p.id);
  await until(() => heard.count === 1);
});

test("a write of ours and an arrival both move the version, and both are announced", { timeout: 5000 }, async (t) => {
  const ledgers = make(t, { focused: NEVER, background: NEVER });
  const p = await project();
  const view = await ledgers.pagesOf(p);
  const heard = listen(ledgers, p);
  const start = view.version;

  // Ours: moved and announced before the write resolves, and the state read
  // beside the new version already holds it. The fold catching up with it
  // may announce once more; a second notice only costs a window a fetch.
  await pages.addBlock(view, "Mira", "ours", undefined, randomUUID());
  assert.ok(view.version > start);
  assert.ok(heard.count >= 1);
  const ours = heard.count;
  assert.deepEqual(
    pages.getPage(view.state, "Mira").blocks.map((block) => block.text),
    ["ours"],
  );

  const afterOurs = view.version;
  await writeFromElsewhere(p, "theirs");
  ledgers.setFocused(true, p.id);
  await until(() => pages.getPage(view.state, "Elsewhere").blocks.length === 1);
  assert.ok(view.version > afterOurs);
  assert.ok(heard.count > ours);
});

test("the version never goes back, across projects", { timeout: 5000 }, async (t) => {
  const ledgers = make(t, { focused: NEVER, background: NEVER });
  const a = await ledgers.pagesOf(await project());
  await pages.addBlock(a, "Mira", "one", undefined, randomUUID());
  const b = await ledgers.pagesOf(await project());
  assert.ok(b.version > a.version);
});

type Pages = typeof pages.pagesFold.initial;

/** A post the fake ledger is holding: the event it will hand back, and how to land it at a reach. */
type Held = { event: Event; land: (reach: number) => void };

/**
 * A ledger whose folds arrive when the test hands them out, and whose posts
 * land when the test says, at the reach it says: the order the races in #170
 * need, which a real ledger only shows now and then.
 */
function fakeLedger(first: Fold<Pages>) {
  const folds: Fold<Pages>[] = [first];
  let wake: () => void = () => undefined;
  const reaches = new WeakMap<Event, number>();
  const posts: Held[] = [];
  const ledger: LedgerPort = {
    onFold: async function* () {
      for (;;) {
        const next = folds.shift();
        if (next) yield next;
        else await new Promise<void>((r) => (wake = r));
      }
    } as unknown as LedgerPort["onFold"],
    reachOf: (event) => reaches.get(event),
    writer: () => ({
      directory: "/fake/writer",
      post: (v, type, payload) =>
        new Promise<Event>((resolve) => {
          const event: Event = { type, v, at: new Date(0).toISOString(), payload };
          posts.push({ event, land: (reach) => (reaches.set(event, reach), resolve(event)) });
        }),
    }),
    status: { devices: [], ignored: [] },
    pace: () => undefined,
    refresh: async () => undefined,
    close: async () => undefined,
  };
  return {
    ledger,
    posts,
    fold(next: Fold<Pages>) {
      folds.push(next);
      wake();
    },
  };
}

/** Lets the fold loop take whatever was handed to it. */
const settle = () => new Promise<void>((r) => setImmediate(r));

const texts = (state: Pages, title: string) => pages.getPage(state, title).blocks.map((block) => block.text);

test("a fold that was short of our write when it ran is skipped, so no version drops the write", async () => {
  const fake = fakeLedger({ state: pages.pagesFold.initial, reached: 10 });
  const ledgers = createLedgers(undefined, async () => fake.ledger);
  const view = await ledgers.pagesOf({ id: "p", path: "/fake" });

  const write = pages.addBlock(view, "Mira", "ours", undefined, randomUUID());
  await until(() => fake.posts.length === 1);
  // An arrival made the log 11 before our post ingested its event at 12.
  fake.posts[0].land(12);
  await write;
  const replied = view.version;
  assert.deepEqual(texts(view.state, "Mira"), ["ours"]);

  // The fold computed at 11, with the arrival and without ours, is only now taken up.
  const stale: Pages = { blocks: new Map(), titles: new Map(), properties: new Map() };
  fake.fold({ state: stale, reached: 11 });
  await settle();
  assert.equal(view.version, replied, "the stale fold moved the version");
  assert.deepEqual(texts(view.state, "Mira"), ["ours"], "the stale fold dropped our write");

  // The fold that reaches our write is the truth.
  const both = pages.pagesFold.reduce(stale, fake.posts[0].event);
  fake.fold({ state: both, reached: 12 });
  await until(() => view.state === both);
  assert.ok(view.version > replied);
});

test("a write the fold took up first is not folded in again", async () => {
  const fake = fakeLedger({ state: pages.pagesFold.initial, reached: 10 });
  const ledgers = createLedgers(undefined, async () => fake.ledger);
  const view = await ledgers.pagesOf({ id: "p", path: "/fake" });

  const write = pages.addBlock(view, "Mira", "ours", undefined, randomUUID());
  await until(() => fake.posts.length === 1);
  // The post ingested its event at 11, and the fold took it up before the post handed it back.
  const withOurs = pages.pagesFold.reduce(pages.pagesFold.initial, fake.posts[0].event);
  fake.fold({ state: withOurs, reached: 11 });
  await until(() => view.state === withOurs);
  const taken = view.version;

  fake.posts[0].land(11);
  await write;
  assert.equal(view.state, withOurs, "the write was folded in a second time");
  assert.equal(view.version, taken, "the version moved for a state that changed nothing");
  assert.deepEqual(texts(view.state, "Mira"), ["ours"]);
});
