/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openMigrated } from "./sqlite.ts";

// Composition root for these tests: a fresh directory per test for the cases
// that reopen a file, and `:memory:` for the rest.

const tables = (db: ReturnType<typeof openMigrated>) =>
  (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[]
  ).map((row) => row.name);

const version = (db: ReturnType<typeof openMigrated>) =>
  (db.prepare("PRAGMA user_version").get() as { user_version: number })
    .user_version;

function scratchFile(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(tmpdir(), "sqlite-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "test.db");
}

test("runs every migration in order and counts them", () => {
  const db = openMigrated(":memory:", [
    "CREATE TABLE a (x INTEGER);",
    "CREATE TABLE b (y INTEGER);",
  ]);
  assert.deepEqual(tables(db), ["a", "b"]);
  assert.equal(version(db), 2);
});

test("reopening runs only the migrations added since", (t) => {
  const file = scratchFile(t);
  openMigrated(file, ["CREATE TABLE a (x INTEGER);"]).close();

  const db = openMigrated(file, [
    "CREATE TABLE a (x INTEGER);",
    "CREATE TABLE b (y INTEGER);",
  ]);
  assert.deepEqual(tables(db), ["a", "b"]);
  assert.equal(version(db), 2);
  db.close();
});

test("a migration that fails leaves the file at the one before it", (t) => {
  const file = scratchFile(t);
  assert.throws(() =>
    openMigrated(file, ["CREATE TABLE a (x INTEGER);", "NOT SQL;"]),
  );

  const db = openMigrated(file, ["CREATE TABLE a (x INTEGER);"]);
  assert.equal(version(db), 1);
  assert.deepEqual(tables(db), ["a"]);
  db.close();
});
