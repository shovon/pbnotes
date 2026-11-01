/**
 * Run with: npm test
 *
 * The property commands over a view whose `dispatch` folds into a held state,
 * with no log around it. Each test is its own composition root.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getProperties, pagesFold } from "../pages.ts";
import type { Pages, PagesView } from "../pages.ts";
import { removeProperty, renameProperty, setProperty } from "./commands.ts";

/** A view over a held state, and every event it was handed, in order. */
function memory(): PagesView & { written: { type: string; payload: unknown }[] } {
  let state: Pages = pagesFold.initial;
  const written: { type: string; payload: unknown }[] = [];
  return {
    written,
    get state() {
      return state;
    },
    async dispatch(v, type, payload) {
      written.push({ type: type.split("#")[1], payload });
      state = pagesFold.reduce(state, { type, v, payload });
    },
  };
}

test("setProperty writes the value, and writing it again writes nothing", async () => {
  const view = memory();
  assert.deepEqual(await setProperty(view, "Foo", "Status", "done"), [
    { key: "Status", value: "done" },
  ]);
  await setProperty(view, "foo", " status ", "done");
  assert.equal(view.written.length, 1);
  await setProperty(view, "Foo", "Status", "");
  assert.deepEqual(getProperties(view.state, "Foo"), [{ key: "Status", value: "" }]);
  assert.equal(view.written.length, 2);
});

test("setProperty refuses a blank page or key and writes nothing", async () => {
  const view = memory();
  await assert.rejects(setProperty(view, "Foo", "   ", "x"));
  await assert.rejects(setProperty(view, "", "Status", "x"));
  assert.equal(view.written.length, 0);
});

test("removeProperty removes, and removing a key the page lacks writes nothing", async () => {
  const view = memory();
  await removeProperty(view, "Foo", "Status");
  assert.equal(view.written.length, 0);
  await setProperty(view, "Foo", "Status", "done");
  assert.deepEqual(await removeProperty(view, "Foo", "STATUS"), []);
  assert.deepEqual(view.written.map((it) => it.type), ["property.set", "property.removed"]);
});

test("renameProperty sets the new key before it removes the old, keeping the value", async () => {
  const view = memory();
  await setProperty(view, "Foo", "Owner", "Mira");
  view.written.length = 0;
  assert.deepEqual(await renameProperty(view, "Foo", "Owner", "Author"), [
    { key: "Author", value: "Mira" },
  ]);
  assert.deepEqual(view.written, [
    { type: "property.set", payload: { page: "Foo", key: "Author", value: "Mira" } },
    { type: "property.removed", payload: { page: "Foo", key: "Owner" } },
  ]);
});

test("a rename that stops after its set leaves both keys", async () => {
  const view = memory();
  await setProperty(view, "Foo", "Owner", "Mira");
  const dispatch = view.dispatch;
  let calls = 0;
  view.dispatch = async (v, type, payload) => {
    if (++calls > 1) throw new Error("crash");
    return dispatch(v, type, payload);
  };
  await assert.rejects(renameProperty(view, "Foo", "Owner", "Author"));
  assert.deepEqual(getProperties(view.state, "Foo"), [
    { key: "Author", value: "Mira" },
    { key: "Owner", value: "Mira" },
  ]);
});

test("renameProperty refuses a key the page already has, a missing key and a blank one", async () => {
  const view = memory();
  await setProperty(view, "Foo", "Owner", "Mira");
  await setProperty(view, "Foo", "Status", "done");
  view.written.length = 0;
  await assert.rejects(renameProperty(view, "Foo", "Owner", " status "), /already exists/);
  await assert.rejects(renameProperty(view, "Foo", "Nothing", "Else"), /No such property/);
  await assert.rejects(renameProperty(view, "Foo", "Owner", "  "));
  assert.equal(view.written.length, 0);
});

test("renaming a key onto itself in another case writes nothing", async () => {
  const view = memory();
  await setProperty(view, "Foo", "status", "done");
  view.written.length = 0;
  assert.deepEqual(await renameProperty(view, "Foo", "status", "Status"), [
    { key: "status", value: "done" },
  ]);
  assert.equal(view.written.length, 0);
});
