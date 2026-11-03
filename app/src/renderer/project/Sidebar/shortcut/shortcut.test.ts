/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { togglesSidebar } from "./shortcut.ts";

const press = (key: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

test("Cmd+\\ on macOS, Ctrl+\\ elsewhere", () => {
  assert.equal(togglesSidebar(press("\\", { metaKey: true }), true), true);
  assert.equal(togglesSidebar(press("\\", { ctrlKey: true }), false), true);
});

test("the other platform's modifier does nothing", () => {
  assert.equal(togglesSidebar(press("\\", { ctrlKey: true }), true), false);
  assert.equal(togglesSidebar(press("\\", { metaKey: true }), false), false);
});

test("another modifier, another key, or none, does nothing", () => {
  assert.equal(togglesSidebar(press("\\", { metaKey: true, shiftKey: true }), true), false);
  assert.equal(togglesSidebar(press("\\", { metaKey: true, altKey: true }), true), false);
  assert.equal(togglesSidebar(press("b", { metaKey: true }), true), false);
  assert.equal(togglesSidebar(press("\\"), true), false);
});
