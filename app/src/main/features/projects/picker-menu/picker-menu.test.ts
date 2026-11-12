/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { drawsSublabels, homeRelative, pickerLook, pickerRows } from "./picker-menu.ts";

test("home relative: home shown as ~, whole directories only", () => {
  assert.equal(homeRelative("/Users/sal/notes", "/Users/sal"), "~/notes");
  assert.equal(homeRelative("/Users/sal/notes", "/Users/sal/"), "~/notes");
  assert.equal(homeRelative("/Users/sal", "/Users/sal"), "~");
  assert.equal(homeRelative("/Users/sally/notes", "/Users/sal"), "/Users/sally/notes");
  assert.equal(homeRelative("/Volumes/archive", "/Users/sal"), "/Volumes/archive");
  assert.equal(homeRelative("C:\\Users\\sal\\notes", "C:\\Users\\sal"), "~\\notes");
  assert.equal(homeRelative("/notes", ""), "/notes");
});

test("sublabels: macOS 14.4 and later only", () => {
  assert.equal(drawsSublabels("darwin", "14.4"), true);
  assert.equal(drawsSublabels("darwin", "14.4.1"), true);
  assert.equal(drawsSublabels("darwin", "15.0"), true);
  assert.equal(drawsSublabels("darwin", "26"), true);
  assert.equal(drawsSublabels("darwin", "14.3.1"), false);
  assert.equal(drawsSublabels("darwin", "13.6"), false);
  assert.equal(drawsSublabels("darwin", ""), false);
  assert.equal(drawsSublabels("win32", "10.0.22631"), false);
  assert.equal(drawsSublabels("linux", "6.8.0"), false);
});

test("look: macOS keeps the directory and a radio; elsewhere, the name and a checkbox", () => {
  assert.deepEqual(pickerLook("darwin", "15.0"), { directory: "sublabel", mark: "radio" });
  assert.deepEqual(pickerLook("darwin", "13.6"), { directory: "dash", mark: "radio" });
  assert.deepEqual(pickerLook("win32", "10.0.22631"), { directory: "none", mark: "checkbox" });
  assert.deepEqual(pickerLook("linux", "6.8.0"), { directory: "none", mark: "checkbox" });
});

const projects = [
  { id: "a", name: "notes", path: "/Users/sal/Documents/notes" },
  { id: "b", name: "archive", path: "/Volumes/archive" },
];

const sublabel = { home: "/Users/sal", directory: "sublabel", mark: "radio" } as const;

test("rows: name with its directory under it, the open one checked", () => {
  assert.deepEqual(pickerRows(projects, "b", sublabel), [
    { kind: "project", id: "a", label: "notes", sublabel: "~/Documents/notes", checked: false, mark: "radio" },
    { kind: "project", id: "b", label: "archive", sublabel: "/Volumes/archive", checked: true, mark: "radio" },
    { kind: "separator" },
    { kind: "add", label: "Open project…" },
  ]);
});

test("rows: without sublabels, the directory after a dash", () => {
  assert.deepEqual(pickerRows(projects, "a", { ...sublabel, directory: "dash" }), [
    { kind: "project", id: "a", label: "notes — ~/Documents/notes", checked: true, mark: "radio" },
    { kind: "project", id: "b", label: "archive — /Volumes/archive", checked: false, mark: "radio" },
    { kind: "separator" },
    { kind: "add", label: "Open project…" },
  ]);
});

test("rows: the name alone, marked with a checkbox", () => {
  assert.deepEqual(pickerRows(projects, "a", { home: "/Users/sal", directory: "none", mark: "checkbox" }), [
    { kind: "project", id: "a", label: "notes", checked: true, mark: "checkbox" },
    { kind: "project", id: "b", label: "archive", checked: false, mark: "checkbox" },
    { kind: "separator" },
    { kind: "add", label: "Open project…" },
  ]);
});

test("rows: none open, or none at all, still end in Open project…", () => {
  const rows = pickerRows(projects, null, sublabel);
  assert.ok(rows.every((row) => row.kind !== "project" || !row.checked));
  assert.deepEqual(pickerRows([], null, sublabel), [
    { kind: "separator" },
    { kind: "add", label: "Open project…" },
  ]);
});
