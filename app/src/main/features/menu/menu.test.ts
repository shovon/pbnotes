/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { MenuItemConstructorOptions } from "electron";
import { appMenu } from "./menu.ts";
import type { Way } from "./menu.ts";

/** The Edit menu's items. */
function editOf(menu: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  const edit = menu.find((it) => it.label === "Edit");
  assert.ok(edit && Array.isArray(edit.submenu));
  return edit.submenu as MenuItemConstructorOptions[];
}

/** What an item is, for comparing: its role, its label, or that it is a separator. */
const shape = (it: MenuItemConstructorOptions) => it.role ?? it.label ?? it.type;

test("Undo and Redo are the app's own, on their keys, and tell take which way", () => {
  for (const mac of [true, false]) {
    const taken: Way[] = [];
    const [undo, redo] = editOf(appMenu(mac, (way) => taken.push(way)));
    assert.deepEqual([undo.label, undo.accelerator, undo.role], ["Undo", "CmdOrCtrl+Z", undefined]);
    assert.deepEqual([redo.label, redo.accelerator, redo.role], ["Redo", "Shift+CmdOrCtrl+Z", undefined]);
    (undo.click as () => void)();
    (redo.click as () => void)();
    assert.deepEqual(taken, ["undo", "redo"]);
  }
});

test("no item calls the browser's own undo or redo", () => {
  const roles = (items: MenuItemConstructorOptions[]): string[] =>
    items.flatMap((it) => [
      ...(it.role ? [it.role] : []),
      ...(Array.isArray(it.submenu) ? roles(it.submenu as MenuItemConstructorOptions[]) : []),
    ]);
  for (const mac of [true, false]) {
    const all = roles(appMenu(mac, () => undefined));
    assert.equal(all.includes("undo") || all.includes("redo"), false);
  }
});

test("the rest is Electron's default: the menus, and the Edit menu's items in order", () => {
  const top = (mac: boolean) => appMenu(mac, () => undefined).map(shape);
  assert.deepEqual(top(true), ["appMenu", "fileMenu", "Edit", "viewMenu", "windowMenu"]);
  assert.deepEqual(top(false), ["fileMenu", "Edit", "viewMenu", "windowMenu"]);
  assert.deepEqual(editOf(appMenu(true, () => undefined)).map(shape), [
    "Undo",
    "Redo",
    "separator",
    "cut",
    "copy",
    "paste",
    "pasteAndMatchStyle",
    "delete",
    "selectAll",
    "separator",
    "Speech",
  ]);
  assert.deepEqual(editOf(appMenu(false, () => undefined)).map(shape), [
    "Undo",
    "Redo",
    "separator",
    "cut",
    "copy",
    "paste",
    "delete",
    "separator",
    "selectAll",
  ]);
});
