/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { markersOf, requireFilter } from "./filter.ts";

test("a filter of markers is read as it was sent, each marker once", () => {
  assert.deepEqual(requireFilter([]), []);
  assert.deepEqual(requireFilter([{ kind: "marker", markers: ["TODO", "DOING", "TODO"] }]), [
    { kind: "marker", markers: ["TODO", "DOING"] },
  ]);
});

test("what a condition does not name is left out", () => {
  assert.deepEqual(requireFilter([{ kind: "marker", markers: ["DONE"], extra: 1 }]), [
    { kind: "marker", markers: ["DONE"] },
  ]);
});

test("anything that is not a filter is refused", () => {
  for (const value of [
    undefined,
    null,
    "TODO",
    {},
    [null],
    [{ kind: "page", page: "Mira" }],
    [{ kind: "marker" }],
    [{ kind: "marker", markers: ["todo"] }],
    [{ kind: "marker", markers: ["LATER"] }],
    [
      { kind: "marker", markers: ["TODO"] },
      { kind: "marker", markers: ["DONE"] },
    ],
  ]) {
    assert.throws(() => requireFilter(value), TypeError, JSON.stringify(value));
  }
});

test("no marker condition is every marker, and an empty one is none", () => {
  assert.deepEqual([...markersOf([])], ["TODO", "DOING", "DONE"]);
  assert.deepEqual([...markersOf([{ kind: "marker", markers: ["DONE"] }])], ["DONE"]);
  assert.deepEqual([...markersOf([{ kind: "marker", markers: [] }])], []);
});
