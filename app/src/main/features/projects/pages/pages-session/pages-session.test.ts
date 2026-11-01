/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { blockEdited, pagesFold } from "@pbnotes/pages";
import { createPagesSession } from "./pages-session.ts";
import type { PagesView } from "./pages-session.ts";

/**
 * A ledger held in memory: the real fold, a version that moves with it as
 * `ledgers.ts`'s does, and a `dispatch` that waits on a gate a test can hold
 * shut, so a write can be kept in flight. `arrive` stands in for another
 * device's event landing.
 */
function ledger() {
  let state = pagesFold.initial;
  let version = 0;
  let gate: Promise<void> = Promise.resolve();
  const fold = (event: { type: string; v: number; payload: unknown }) => {
    state = pagesFold.reduce(state, event);
    version++;
  };
  const view: PagesView = {
    get state() {
      return state;
    },
    get version() {
      return version;
    },
    status: { devices: [], ignored: [] },
    async dispatch(v, type, payload) {
      await gate;
      fold({ type, v, payload });
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
    [...state.blocks.values()].flatMap((blocks) =>
      blocks.map((block) => block.text),
    );
  return { view, hold, texts, arrive: fold };
}

/**
 * The composition root for these tests: what is open is whichever ledger a
 * test says, read the moment `require` is called — as `requireProject` reads
 * it — and refused when there is none. Every version told is kept.
 */
function session(first: PagesView | null) {
  let current = first;
  const told: number[] = [];
  const pages = createPagesSession(
    {
      async require() {
        const view = current;
        await Promise.resolve();
        if (!view) throw new Error("not reachable");
        return view;
      },
    },
    (version) => told.push(version),
  );
  return {
    pages,
    told,
    openLedger: (view: PagesView | null): void => {
      current = view;
    },
  };
}

const TODAY = "2026-10-27";
const shown = (view: { showing: { page: { blocks: { text: string }[] } }[] }) =>
  view.showing.flatMap(({ page }) => page.blocks.map((block) => block.text));

test("a write replies with the version the fold reached", async () => {
  const { view } = ledger();
  const { pages } = session(view);
  assert.equal(await pages.run({ type: "addBlock", id: "a1", title: TODAY, text: "one" }), 1);
  assert.equal(await pages.run({ type: "editBlock", blockId: "a1", text: "two" }), 2);
  // An indent with nowhere to go changes nothing, and names the version held.
  assert.equal(await pages.run({ type: "indentBlock", blockId: "a1" }), 2);
});

test("a view holds every write up to the version it reports", async () => {
  const { view } = ledger();
  const { pages } = session(view);
  const v = await pages.run({ type: "addBlock", id: "a1", title: TODAY, text: "one" });
  const seen = await pages.view(undefined, TODAY);
  assert.equal(seen.version, v);
  assert.deepEqual(shown(seen), ["one"]);
});

test("an arrival moves the version as a write does", async () => {
  const { view, arrive } = ledger();
  const { pages } = session(view);
  await pages.run({ type: "addBlock", id: "a1", title: TODAY, text: "one" });
  const before = (await pages.view(undefined, TODAY)).version;
  arrive(blockEdited("a1", "from elsewhere"));
  const after = await pages.view(undefined, TODAY);
  assert.ok(after.version > before);
  assert.deepEqual(shown(after), ["from elsewhere"]);
});

test("the view is the journal with today on top, or the one page asked for", async () => {
  const { view } = ledger();
  const { pages } = session(view);
  // Nothing written: today is there anyway, empty.
  const empty = await pages.view(undefined, TODAY);
  assert.deepEqual(empty.showing.map(({ page }) => [page.title, page.blocks.length]), [[TODAY, 0]]);
  await pages.run({ type: "addBlock", id: "a1", title: "Mira", text: "hi" });
  const page = await pages.view({ page: "Mira" }, TODAY);
  assert.deepEqual(page.showing.map(({ page }) => page.title), ["Mira"]);
  // Zoomed, what links to the page is not shown.
  const zoomed = await pages.view({ page: "Mira", block: "a1" }, TODAY);
  assert.deepEqual(zoomed.showing[0].references, []);
});

test("refreshing tells the windows the version, and nothing when nothing is reachable", async () => {
  const { view } = ledger();
  const { pages, told, openLedger } = session(view);
  await pages.run({ type: "addBlock", id: "a1", title: TODAY, text: "one" });
  pages.refreshPages();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(told, [1]);
  openLedger(null);
  pages.refreshPages();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(told, [1]);
  await assert.rejects(pages.view(undefined, TODAY), /not reachable/);
});

test("writes are recorded in the order they arrive, so one may name the block before it", async () => {
  const a = ledger();
  const { pages } = session(a.view);
  const release = a.hold();
  // Sent back to back, as Enter then typing does: the second names the first,
  // which is not on the page until the first has been written.
  const first = pages.run({ type: "addBlock", id: "a1", title: TODAY, text: "one" });
  const second = pages.run({ type: "addBlock", id: "a2", title: TODAY, text: "two", after: "a1" });
  release();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(a.texts(), ["one", "two"]);
});

test("a refused write does not hold up the ones behind it", async () => {
  const { view, texts } = ledger();
  const { pages } = session(view);
  const refused = pages.run({ type: "editBlock", blockId: "nope", text: "text" });
  const next = pages.run({ type: "addBlock", id: "a1", title: TODAY, text: "one" });
  await assert.rejects(refused, /No such block/);
  await next;
  assert.deepEqual(texts(), ["one"]);
});

test("a write lands where it was sent, even when what is open changes while it waits", async () => {
  const a = ledger();
  const b = ledger();
  const { pages, openLedger } = session(a.view);
  const release = a.hold();
  const first = pages.run({ type: "addBlock", id: "a1", title: TODAY, text: "one" });
  const second = pages.run({ type: "addBlock", id: "a2", title: TODAY, text: "two", after: "a1" });
  openLedger(b.view);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(a.texts(), ["one", "two"]);
  assert.deepEqual(b.texts(), []);
});

test("with nothing reachable, a write is refused", async () => {
  const { pages } = session(null);
  await assert.rejects(pages.run({ type: "addBlock", id: "a1", title: TODAY, text: "one" }), /not reachable/);
});

test("run reaches each block command, and records them in the order they arrived", async () => {
  const { view, hold } = ledger();
  const { pages } = session(view);
  const release = hold();
  const writes = [
    pages.run({ type: "addBlock", id: "a1", title: TODAY, text: "one" }),
    pages.run({ type: "addBlock", id: "a2", title: TODAY, text: "two", after: "a1" }),
    pages.run({ type: "indentBlock", blockId: "a2" }),
    pages.run({ type: "editBlock", blockId: "a2", text: "two!" }),
    pages.run({ type: "outdentBlock", blockId: "a2" }),
    pages.run({ type: "addBlock", id: "a3", title: TODAY, text: "three", after: "a2" }),
    pages.run({ type: "deleteBlock", blockId: "a1" }),
  ];
  release();
  await Promise.all(writes);
  assert.deepEqual(shown(await pages.view(undefined, TODAY)), ["two!", "three"]);
});

test("property writes are recorded in order with the block writes around them", async () => {
  const { view, hold } = ledger();
  const { pages } = session(view);
  const release = hold();
  const writes = [
    pages.run({ type: "addBlock", id: "a1", title: "Mira", text: "hi" }),
    pages.run({ type: "setProperty", title: "Mira", key: "Owner", value: "Sal" }),
    pages.run({ type: "renameProperty", title: "Mira", from: "Owner", to: "Author" }),
    pages.run({ type: "editBlock", blockId: "a1", text: "hello" }),
    pages.run({ type: "setProperty", title: "Mira", key: "Status", value: "done" }),
    pages.run({ type: "removeProperty", title: "Mira", key: "Status" }),
  ];
  release();
  await Promise.all(writes);
  const seen = await pages.view({ page: "Mira" }, TODAY);
  assert.deepEqual(shown(seen), ["hello"]);
  assert.deepEqual(seen.showing[0].properties, [{ key: "Author", value: "Sal" }]);
});

test("a refused rename writes nothing and does not hold up the writes behind it", async () => {
  const { view } = ledger();
  const { pages } = session(view);
  await pages.run({ type: "setProperty", title: "Mira", key: "Owner", value: "Sal" });
  await pages.run({ type: "setProperty", title: "Mira", key: "Author", value: "Kim" });
  const before = (await pages.view({ page: "Mira" }, TODAY)).version;
  await assert.rejects(
    pages.run({ type: "renameProperty", title: "Mira", from: "Owner", to: "author" }),
  );
  assert.equal((await pages.view({ page: "Mira" }, TODAY)).version, before);
  await pages.run({ type: "removeProperty", title: "Mira", key: "Owner" });
  assert.deepEqual((await pages.view({ page: "Mira" }, TODAY)).showing[0].properties, [
    { key: "Author", value: "Kim" },
  ]);
});

test("find lists the matching titles, then the matching blocks with their page", async () => {
  const { view } = ledger();
  const { pages } = session(view);
  await pages.run({ type: "addBlock", id: "m1", title: "Mira", text: "her page" });
  await pages.run({ type: "addBlock", id: "d1", title: TODAY, text: "Call [[Mira]]" });
  assert.deepEqual(await pages.find("mira"), {
    pages: ["Mira"],
    blocks: [{ id: "d1", page: TODAY, text: "Call Mira" }],
  });
});
