/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { MenuItemConstructorOptions } from "electron";
import { appMenu } from "./menu.ts";
import type { Way } from "./menu.ts";
import type { TabItem } from "../../../shared/window.ts";

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
    const [undo, redo] = editOf(appMenu(mac, (way) => taken.push(way), () => undefined));
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
    const all = roles(appMenu(mac, () => undefined, () => undefined));
    assert.equal(all.includes("undo") || all.includes("redo"), false);
  }
});

test("the rest is Electron's default: the menus, and the Edit menu's items in order", () => {
  const top = (mac: boolean) => appMenu(mac, () => undefined, () => undefined).map(shape);
  assert.deepEqual(top(true), ["appMenu", "File", "Edit", "viewMenu", "Window"]);
  assert.deepEqual(top(false), ["File", "Edit", "viewMenu", "Window"]);
  assert.deepEqual(editOf(appMenu(true, () => undefined, () => undefined)).map(shape), [
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
  assert.deepEqual(editOf(appMenu(false, () => undefined, () => undefined)).map(shape), [
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

/** A top menu's items, by its label. */
function itemsOf(menu: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions[] {
  const it = menu.find((item) => item.label === label);
  assert.ok(it && Array.isArray(it.submenu));
  return it.submenu as MenuItemConstructorOptions[];
}

/** Every item under `items`, submenus included. */
const every = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] =>
  items.flatMap((it) => [it, ...(Array.isArray(it.submenu) ? every(it.submenu as MenuItemConstructorOptions[]) : [])]);

test("the tab items are the app's own, on their keys, and tell tab which item (#304)", () => {
  for (const mac of [true, false]) {
    const told: TabItem[] = [];
    const menu = appMenu(mac, () => undefined, (item) => told.push(item));
    const items = every(menu).filter((it) => it.label?.endsWith("Tab"));
    assert.deepEqual(
      items.map((it) => [it.label, it.accelerator]),
      [
        ["New Tab", "CmdOrCtrl+T"],
        ["Close Tab", "CmdOrCtrl+W"],
        ["Next Tab", "Ctrl+Tab"],
        ["Previous Tab", "Ctrl+Shift+Tab"],
      ],
    );
    for (const it of items) (it.click as () => void)();
    assert.deepEqual(told, ["new", "close", "next", "previous"]);
    assert.equal(itemsOf(menu, "File")[0].label, "New Tab");
  }
});

test("Close Tab alone takes Cmd/Ctrl+W, and Close Window keeps Shift+Cmd/Ctrl+W (#304)", () => {
  for (const mac of [true, false]) {
    const all = every(appMenu(mac, () => undefined, () => undefined));
    assert.deepEqual(
      all.filter((it) => it.accelerator === "CmdOrCtrl+W").map((it) => it.label),
      ["Close Tab"],
    );
    const close = all.filter((it) => it.role === "close");
    assert.deepEqual(close.map((it) => it.accelerator), [mac ? "Shift+Cmd+W" : "Shift+Ctrl+W"]);
  }
});

test("the File and Window menus keep the default's items (#304)", () => {
  const shapes = (mac: boolean, label: string) =>
    itemsOf(appMenu(mac, () => undefined, () => undefined), label).map(shape);
  assert.deepEqual(shapes(true, "File"), ["New Tab", "separator", "close"]);
  assert.deepEqual(shapes(false, "File"), ["New Tab", "separator", "quit"]);
  assert.deepEqual(shapes(true, "Window"), [
    "minimize",
    "zoom",
    "separator",
    "Close Tab",
    "Next Tab",
    "Previous Tab",
    "separator",
    "front",
    "separator",
    "window",
  ]);
  assert.deepEqual(shapes(false, "Window"), [
    "minimize",
    "zoom",
    "separator",
    "Close Tab",
    "Next Tab",
    "Previous Tab",
    "separator",
    "close",
  ]);
});
