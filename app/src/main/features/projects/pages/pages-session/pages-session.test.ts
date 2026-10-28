/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pagesFold } from "@pbnotes/pages";
import type { PagesState } from "../../../../../shared/pages.ts";
import type { PagesView } from "../pages-store/pages-store.ts";
import { createPagesSession } from "./pages-session.ts";

/**
 * A ledger held in memory: the real fold, and a `dispatch` that waits on a
 * gate a test can hold shut, so a write can be kept in flight.
 */
function ledger() {
  let state = pagesFold.initial;
  let gate: Promise<void> = Promise.resolve();
  const view: PagesView = {
    get state() {
      return state;
    },
    status: { devices: [], ignored: [] },
    async dispatch(v, type, payload) {
      await gate;
      state = pagesFold.reduce(state, { type, v, payload });
    },
  };
  /** Holds every dispatch until the returned function is called. */
  const hold = () => {
    let release!: () => void;
    gate = new Promise<void>((resolve) => (release = resolve));
    return release;
  };
  /** Every top-level block's text, page by page. */
  const texts = () =>
    Object.values(state.blocks).flatMap((blocks) =>
      blocks.map((block) => block.text),
    );
  return { view, hold, texts };
}

/**
 * The composition root for these tests: what is open is whichever ledger a
 * test says, read the moment `require` is called — as `requireProject` reads
 * it — and refused when there is none. The clock is fixed until a test moves
 * it, and every state sent is kept.
 */
function session(first: PagesView | null) {
  let current = first;
  let clock = new Date(2026, 9, 27, 9);
  const sent: PagesState[] = [];
  const pages = createPagesSession(
    {
      async require() {
        const view = current;
        await Promise.resolve();
        if (!view) throw new Error("not reachable");
        return view;
      },
      saveImage: async () => "images/x.png",
      findImage: async () => undefined,
    },
    () => clock,
    (state) => void sent.push(state),
  );
  return {
    pages,
    sent,
    openLedger: (view: PagesView | null): void => {
      current = view;
    },
    setClock: (date: Date): void => {
      clock = date;
    },
  };
}

const TODAY = "2026-10-27";
const shown = (state: PagesState | undefined) =>
  state?.showing.flatMap(({ page }) => page.blocks.map((block) => block.text));

test("a write's state is sent before its reply", async () => {
  const { view } = ledger();
  const { pages, sent } = session(view);
  await pages.addBlock("a1", TODAY, "one");
  assert.deepEqual(shown(sent.at(-1)), ["one"]);
});

test("writes are recorded in the order they arrive, so one may name the block before it", async () => {
  const a = ledger();
  const { pages, sent } = session(a.view);
  const release = a.hold();
  // Sent back to back, as Enter then typing does: the second names the first,
  // which is not on the page until the first has been written.
  const first = pages.addBlock("a1", TODAY, "one");
  const second = pages.addBlock("a2", TODAY, "two", "a1");
  release();
  await Promise.all([first, second]);
  assert.deepEqual(shown(sent.at(-1)), ["one", "two"]);
});

test("a refused write does not hold up the ones behind it", async () => {
  const { view, texts } = ledger();
  const { pages } = session(view);
  const refused = pages.editBlock("nope", "text");
  const next = pages.addBlock("a1", TODAY, "one");
  await assert.rejects(refused, /No such block/);
  await next;
  assert.deepEqual(texts(), ["one"]);
});

test("a write lands where it was sent, even when what is open changes while it waits", async () => {
  const a = ledger();
  const b = ledger();
  const { pages, openLedger } = session(a.view);
  const release = a.hold();
  const first = pages.addBlock("a1", TODAY, "one");
  const second = pages.addBlock("a2", TODAY, "two", "a1");
  openLedger(b.view);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(a.texts(), ["one", "two"]);
  assert.deepEqual(b.texts(), []);
});

test("the trail is held here, and starts over when what is open changes", async () => {
  const { view } = ledger();
  const { pages, sent } = session(view);
  await pages.go({ page: "Mira" });
  await pages.go({ page: "Juno", block: "b1" });
  assert.deepEqual(sent.at(-1)?.trail, [
    { page: "Mira" },
    { page: "Juno", block: "b1" },
  ]);
  await pages.rezoom();
  assert.deepEqual(sent.at(-1)?.trail, [
    { page: "Mira" },
    { page: "Juno", block: undefined },
  ]);
  await pages.back();
  assert.deepEqual(sent.at(-1)?.trail, [{ page: "Mira" }]);
  pages.resetTrail();
  await pages.show();
  assert.deepEqual(sent.at(-1)?.trail, []);
});

test("with nothing reachable, show says so and nothing is sent", async () => {
  const { pages, sent } = session(null);
  await assert.rejects(pages.show(), /not reachable/);
  pages.refreshPages();
  // A step still resolves: the windows keep what they have.
  await pages.go({ page: "Mira" });
  await assert.rejects(pages.addBlock("a1", TODAY, "one"), /not reachable/);
  assert.equal(sent.length, 0);
});

test("which day is today is the clock's, read every time a state is sent", async () => {
  const { view } = ledger();
  const { pages, sent, setClock } = session(view);
  await pages.show();
  assert.equal(sent.at(-1)?.showing[0]?.page.title, TODAY);
  setClock(new Date(2026, 9, 28, 9));
  pages.refreshPages();
  await pages.show();
  assert.equal(sent.at(-1)?.showing[0]?.page.title, "2026-10-28");
});
