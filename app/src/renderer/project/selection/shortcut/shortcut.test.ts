/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { command, extendsBy, picks, selectsAll } from "./shortcut.ts";

type Mod = "metaKey" | "ctrlKey" | "altKey" | "shiftKey";
const mods = (on: Partial<Record<Mod, boolean>> = {}) => ({
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...on,
});
const press = (key: string, on: Partial<Record<Mod, boolean>> = {}) => ({ key, ...mods(on) });

test("Cmd+click on macOS, Ctrl+click elsewhere, picks", () => {
  assert.equal(picks(mods({ metaKey: true }), true), true);
  assert.equal(picks(mods({ ctrlKey: true }), false), true);
});

test("the other platform's modifier, a second modifier, or none, does not pick", () => {
  assert.equal(picks(mods({ ctrlKey: true }), true), false);
  assert.equal(picks(mods({ metaKey: true }), false), false);
  assert.equal(picks(mods({ metaKey: true, shiftKey: true }), true), false);
  assert.equal(picks(mods(), true), false);
});

test("Cmd+A on macOS and Ctrl+A elsewhere select all, Ctrl+A on macOS does not", () => {
  assert.equal(selectsAll(press("a", { metaKey: true }), true), true);
  assert.equal(selectsAll(press("A", { ctrlKey: true }), false), true);
  assert.equal(selectsAll(press("a", { ctrlKey: true }), true), false);
});

test("Shift+Up and Shift+Down extend, and nothing else does", () => {
  assert.equal(extendsBy(press("ArrowUp", { shiftKey: true })), -1);
  assert.equal(extendsBy(press("ArrowDown", { shiftKey: true })), 1);
  assert.equal(extendsBy(press("ArrowDown")), undefined);
  assert.equal(extendsBy(press("ArrowDown", { shiftKey: true, altKey: true })), undefined);
  assert.equal(extendsBy(press("ArrowLeft", { shiftKey: true })), undefined);
});

test("with blocks selected: arrows move, Shift+arrows extend, Enter opens, Escape clears, Cmd+A selects all", () => {
  assert.deepEqual(command(press("ArrowUp"), true), { kind: "move", by: -1 });
  assert.deepEqual(command(press("ArrowDown", { shiftKey: true }), true), { kind: "extend", by: 1 });
  assert.deepEqual(command(press("Enter"), true), { kind: "open" });
  assert.deepEqual(command(press("Escape"), true), { kind: "clear" });
  assert.deepEqual(command(press("a", { metaKey: true }), true), { kind: "all" });
});

test("any other key, or a key with another modifier, is not a selection command", () => {
  assert.equal(command(press("x"), true), undefined);
  assert.equal(command(press("Enter", { shiftKey: true }), true), undefined);
  assert.equal(command(press("ArrowUp", { altKey: true }), true), undefined);
  assert.equal(command(press("a", { ctrlKey: true }), true), undefined);
});
