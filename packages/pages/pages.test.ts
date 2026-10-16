/**
 * Run with: npm test
 *
 * The gate and the commands with no log around them: a `PagesView` that is
 * nothing but an array, which is all a third party has to supply.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { addBlock, editBlock, getPages, NAMESPACE, pagesFold } from "./pages.ts";
import type { Pages, PagesView } from "./pages.ts";

const TODAY = "2026-09-21";

/** A view over a plain list of events, folded through the gate. */
function memory(): PagesView & { events: unknown[] } {
  const events: { type: string; v: number; payload: unknown }[] = [];
  let state: Pages = pagesFold.initial;
  return {
    events,
    get state() {
      return state;
    },
    async dispatch(v, type, payload) {
      const event = { type, v, payload };
      events.push(event);
      state = pagesFold.reduce(state, event);
    },
  };
}

test("the fold leaves the pages alone for what this build cannot read", () => {
  const state = {};
  const created = { page: TODAY, id: crypto.randomUUID(), text: "x" };
  for (const event of [
    { type: `${NAMESPACE}block.created`, v: 2, payload: created },
    { type: "block.created", v: 1, payload: created },
    { type: `${NAMESPACE}block.renamed`, v: 1, payload: created },
    { type: "__proto__", v: 1, payload: created },
  ]) {
    assert.equal(pagesFold.reduce(state, event), state, event.type);
  }
  assert.notEqual(
    pagesFold.reduce(state, {
      type: `${NAMESPACE}block.created`,
      v: 1,
      payload: created,
    }),
    state,
  );
});

test("a writer with its own log gets the app's checks and the app's fold", async () => {
  const view = memory();
  const page = await addBlock(view, TODAY, "hello");
  await editBlock(view, page.blocks[0].id, "hello #Mira");
  await assert.rejects(editBlock(view, "nope", "x"));
  assert.equal(view.events.length, 2);
  assert.deepEqual(getPages(view)[0].blocks[0].text, "hello #Mira");
});
