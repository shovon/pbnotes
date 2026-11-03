/**
 * Run with: npm test
 *
 * Through `graphFold`, since what counts as a change is read off what the
 * other slices did with the event.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blockCreated,
  blockDeleted,
  blockEdited,
  getEdited,
  graphFold,
  pageDeleted,
  propertySet,
} from "../graph.ts";
import type { Graph } from "../graph.ts";

type Built = { type: string; v: number; payload: unknown };

/** `events` folded in order, each written at the time beside it. */
const fold = (...events: [Built, string | undefined][]): Graph =>
  events.reduce<Graph>(
    (state, [event, at]) => graphFold.reduce(state, at === undefined ? event : { ...event, at }),
    graphFold.initial,
  );

const ms = (iso: string) => Date.parse(iso);

test("a page is edited when a block is written on it, and again when one changes", () => {
  const created = fold([blockCreated("Mira", "hi", undefined, "a"), "2026-11-01T10:00:00.000Z"]);
  assert.equal(getEdited(created, "mira"), ms("2026-11-01T10:00:00.000Z"));

  const edited = fold(
    [blockCreated("Mira", "hi", undefined, "a"), "2026-11-01T10:00:00.000Z"],
    [blockEdited("a", "hello"), "2026-11-02T09:00:00.000Z"],
  );
  assert.equal(getEdited(edited, "Mira"), ms("2026-11-02T09:00:00.000Z"));
});

test("an event that names only a block counts for the page it was on, a delete included", () => {
  const state = fold(
    [blockCreated("Mira", "hi", undefined, "a"), "2026-11-01T10:00:00.000Z"],
    [blockCreated("Other", "x", undefined, "b"), "2026-11-01T11:00:00.000Z"],
    [blockDeleted("a"), "2026-11-03T08:00:00.000Z"],
  );
  assert.equal(getEdited(state, "Mira"), ms("2026-11-03T08:00:00.000Z"));
  assert.equal(getEdited(state, "Other"), ms("2026-11-01T11:00:00.000Z"));
});

test("properties and a page delete are edits to the page they name", () => {
  const state = fold(
    [blockCreated("Mira", "hi", undefined, "a"), "2026-11-01T10:00:00.000Z"],
    [propertySet("Mira", "status", "draft"), "2026-11-02T10:00:00.000Z"],
  );
  assert.equal(getEdited(state, "Mira"), ms("2026-11-02T10:00:00.000Z"));
  const deleted = fold(
    [blockCreated("Mira", "hi", undefined, "a"), "2026-11-01T10:00:00.000Z"],
    [pageDeleted("Mira"), "2026-11-04T10:00:00.000Z"],
  );
  assert.equal(getEdited(deleted, "Mira"), ms("2026-11-04T10:00:00.000Z"));
});

test("the latest time wins, whatever order the events fold in", () => {
  const state = fold(
    [blockCreated("Mira", "hi", undefined, "a"), "2026-11-05T10:00:00.000Z"],
    [blockEdited("a", "hello"), "2026-11-01T10:00:00.000Z"],
  );
  assert.equal(getEdited(state, "Mira"), ms("2026-11-05T10:00:00.000Z"));
});

test("only a change counts: not a link named, not an edit to a missing block, not a missing or bad time", () => {
  const state = fold(
    [blockCreated("Mira", "see [[Elsewhere]]", undefined, "a"), "2026-11-01T10:00:00.000Z"],
    [blockEdited("nope", "x"), "2026-11-09T10:00:00.000Z"],
    [blockEdited("a", "see [[Elsewhere]] again"), undefined],
    [blockEdited("a", "see [[Elsewhere]] once more"), "not a time"],
  );
  assert.equal(getEdited(state, "Mira"), ms("2026-11-01T10:00:00.000Z"));
  assert.equal(getEdited(state, "Elsewhere"), undefined);
  assert.equal(getEdited(state, "nope"), undefined);
});

test("an event this build skips leaves the graph as it was, edited included", () => {
  const state = fold([blockCreated("Mira", "hi", undefined, "a"), "2026-11-01T10:00:00.000Z"]);
  const skipped = graphFold.reduce(state, {
    ...blockEdited("a", "x"),
    v: 99,
    at: "2026-11-09T10:00:00.000Z",
  });
  assert.equal(skipped, state);
});
