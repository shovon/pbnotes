/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { drawsSublabels, homeRelative, pickerRows } from "./picker-menu.ts";

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

const projects = [
  { id: "a", name: "notes", path: "/Users/sal/Documents/notes" },
  { id: "b", name: "archive", path: "/Volumes/archive" },
];

test("rows: name with its directory under it, the open one checked", () => {
  assert.deepEqual(pickerRows(projects, "b", { home: "/Users/sal", sublabels: true }), [
    { kind: "project", id: "a", label: "notes", sublabel: "~/Documents/notes", checked: false },
    { kind: "project", id: "b", label: "archive", sublabel: "/Volumes/archive", checked: true },
    { kind: "separator" },
    { kind: "add", label: "Open project…" },
  ]);
});

test("rows: without sublabels, the directory after a dash", () => {
  assert.deepEqual(pickerRows(projects, "a", { home: "/Users/sal", sublabels: false }), [
    { kind: "project", id: "a", label: "notes — ~/Documents/notes", checked: true },
    { kind: "project", id: "b", label: "archive — /Volumes/archive", checked: false },
    { kind: "separator" },
    { kind: "add", label: "Open project…" },
  ]);
});

test("rows: none open, or none at all, still end in Open project…", () => {
  const rows = pickerRows(projects, null, { home: "/Users/sal", sublabels: true });
  assert.ok(rows.every((row) => row.kind !== "project" || !row.checked));
  assert.deepEqual(pickerRows([], null, { home: "/Users/sal", sublabels: true }), [
    { kind: "separator" },
    { kind: "add", label: "Open project…" },
  ]);
});
