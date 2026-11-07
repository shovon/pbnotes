/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { recentPages, recentSection, sidebar, sidebarSlots } from "./sidebar-slots.ts";

test("recent pages: a list of titles, and nothing else", () => {
  assert.deepEqual(recentPages.decode(["Mira", "2026-10-28"]), ["Mira", "2026-10-28"]);
  assert.deepEqual(recentPages.decode([]), []);
  assert.equal(recentPages.decode(["Mira", 3]), undefined);
  assert.equal(recentPages.decode("Mira"), undefined);
  assert.equal(recentPages.decode(null), undefined);
  assert.equal(recentPages.decode(Array.from({ length: 101 }, () => "p")), undefined);
});

test("sidebar: whether it is collapsed, and the rest dropped", () => {
  assert.deepEqual(sidebar.decode({ collapsed: true }), { collapsed: true });
  assert.deepEqual(sidebar.decode({ collapsed: false, width: 300 }), { collapsed: false });
  assert.equal(sidebar.decode({ collapsed: "yes" }), undefined);
  assert.equal(sidebar.decode(null), undefined);
  assert.equal(sidebar.decode(true), undefined);
});

test("recent section: whether it is collapsed, and the rest dropped", () => {
  assert.deepEqual(recentSection.decode({ collapsed: true }), { collapsed: true });
  assert.equal(recentSection.decode({ collapsed: 1 }), undefined);
  assert.equal(recentSection.decode(undefined), undefined);
});

test("all are declared under the names the renderer uses", () => {
  assert.deepEqual([...sidebarSlots.keys()].sort(), ["recent-pages", "recent-section", "sidebar"]);
});
