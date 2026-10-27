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
import type { Cadence } from "@pbnotes/ledger";
import * as pages from "@pbnotes/pages";
import { createLedgers } from "./ledgers.ts";
import type { LedgerRef, Ledgers, Paces } from "./ledgers.ts";

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
