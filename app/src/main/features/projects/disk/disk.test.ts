/** Run with: npm test */
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDisk } from "./disk.ts";

// Composition root for these tests: the real disk, in a throwaway folder.
let dir = "";
beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "pbnotes-disk-")));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("the same directory canonicalizes the same, through a symlink or ..", async () => {
  const disk = createDisk();
  const real = path.join(dir, "notes");
  await mkdir(real);
  await symlink(real, path.join(dir, "link"));
  assert.equal(await disk.canonicalize(path.join(dir, "link")), real);
  assert.equal(await disk.canonicalize(path.join(real, "..", "notes")), real);
  await assert.rejects(disk.canonicalize(path.join(dir, "gone")));
});

test("a directory is one, a file is not, and a missing path rejects", async () => {
  const disk = createDisk();
  await writeFile(path.join(dir, "file.txt"), "");
  assert.equal(await disk.isDirectory(dir), true);
  assert.equal(await disk.isDirectory(path.join(dir, "file.txt")), false);
  await assert.rejects(disk.isDirectory(path.join(dir, "gone")));
});

test("a probe says available for a directory, and missing for anything else", async () => {
  const disk = createDisk();
  await writeFile(path.join(dir, "file.txt"), "");
  assert.equal(await disk.probe(dir), "available");
  assert.equal(await disk.probe(path.join(dir, "file.txt")), "missing");
  assert.equal(await disk.probe(path.join(dir, "gone")), "missing");
});
