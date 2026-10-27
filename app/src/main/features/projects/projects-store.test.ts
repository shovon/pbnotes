import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDatabase } from "../../db.ts";
import { createProjectsStore } from "./projects-store.ts";

// Composition root for these tests: an in-memory database per store, and a
// throwaway folder to track.
let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "pbnotes-projects-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const store = () => createProjectsStore(openDatabase(":memory:"));

test("adds a folder once, and knows it the second time", async () => {
  const projects = store();
  const first = await projects.addProject(dir);
  assert.equal(first.status, "added");
  assert.equal((await projects.addProject(dir)).status, "already-tracked");
  assert.equal(projects.listProjects().length, 1);
});

test("two stores on two databases share nothing", async () => {
  const a = store();
  const b = store();
  await a.addProject(dir);
  assert.equal(a.listProjects().length, 1);
  assert.deepEqual(b.listProjects(), []);
});

test("a blank name falls back to the folder name", async () => {
  const projects = store();
  const added = await projects.addProject(dir);
  if (added.status !== "added") throw new Error("expected a new project");
  assert.equal(projects.renameProject(added.project.id, "   ")?.name, path.basename(dir));
  assert.equal(projects.renameProject(added.project.id, " Notes ")?.name, "Notes");
});

test("reports a folder that has gone as missing, and forgets a removed one", async () => {
  const projects = store();
  const added = await projects.addProject(dir);
  if (added.status !== "added") throw new Error("expected a new project");
  const { id } = added.project;

  await rm(dir, { recursive: true, force: true });
  assert.deepEqual(await projects.checkAvailability([id]), { [id]: "missing" });

  projects.removeProject(id);
  assert.equal(projects.getProject(id), null);
});
