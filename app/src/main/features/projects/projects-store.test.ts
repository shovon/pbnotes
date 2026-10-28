import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Availability } from "../../../shared/projects.ts";
import { openDatabase } from "../../db.ts";
import { createDisk } from "./disk/disk.ts";
import { createProjectsStore, pathKeyOn } from "./projects-store.ts";
import type { Disk, ProjectsStoreDeps } from "./projects-store.ts";

// Composition root for these tests: an in-memory database per store, a clock
// that moves one second per read, ids that count, and either the real disk
// over a throwaway folder or a disk that holds only what a test says.
let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "pbnotes-projects-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function deps(overrides: Partial<ProjectsStoreDeps> = {}): ProjectsStoreDeps {
  let seconds = 0;
  let ids = 0;
  return {
    disk: createDisk(),
    now: () => new Date(Date.UTC(2026, 9, 27, 9, 0, seconds++)),
    newId: () => `project-${++ids}`,
    pathKey: pathKeyOn("linux"),
    ...overrides,
  };
}

const store = (overrides?: Partial<ProjectsStoreDeps>) =>
  createProjectsStore(openDatabase(":memory:"), deps(overrides));

/**
 * A disk with only the directories and files a test names, each its own
 * canonical path, and whatever a test says each probes as.
 */
function fakeDisk(
  directories: string[],
  {
    files = [],
    probes = {},
  }: { files?: string[]; probes?: Record<string, Availability> } = {},
): Disk {
  const known = (p: string) => directories.includes(p) || files.includes(p);
  return {
    async canonicalize(input) {
      if (!known(input)) throw new Error(`ENOENT: ${input}`);
      return input;
    },
    async isDirectory(p) {
      if (!known(p)) throw new Error(`ENOENT: ${p}`);
      return directories.includes(p);
    },
    async probe(p) {
      return probes[p] ?? (directories.includes(p) ? "available" : "missing");
    },
  };
}

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

test("a new project's id and dates are the ones the store was handed", async () => {
  const projects = store({ disk: fakeDisk(["/notes"]) });
  const added = await projects.addProject("/notes");
  assert.deepEqual(added, {
    status: "added",
    project: {
      id: "project-1",
      path: "/notes",
      name: "notes",
      addedAt: "2026-10-27T09:00:00.000Z",
      lastOpenedAt: null,
      pinned: false,
    },
  });
  assert.equal(
    projects.touchProject("project-1")?.lastOpenedAt,
    "2026-10-27T09:00:01.000Z",
  );
});

test("paths that differ only by case key as one on macOS and Windows, and two on Linux", () => {
  assert.equal(pathKeyOn("darwin")("/Users/Sal/Notes"), "/users/sal/notes");
  assert.equal(pathKeyOn("win32")("C:\\Notes"), "c:\\notes");
  assert.equal(pathKeyOn("linux")("/home/Sal/Notes"), "/home/Sal/Notes");
});

test("the platform's key decides whether a second spelling is a second project", async () => {
  const disk = fakeDisk(["/Notes", "/notes"]);
  for (const [platform, second] of [
    ["darwin", "already-tracked"],
    ["win32", "already-tracked"],
    ["linux", "added"],
  ] as const) {
    const projects = store({ disk, pathKey: pathKeyOn(platform) });
    await projects.addProject("/Notes");
    assert.equal((await projects.addProject("/notes")).status, second, platform);
  }
});

test("a file is not a project, and a path that cannot be read says so", async () => {
  const projects = store({ disk: fakeDisk([], { files: ["/notes.txt"] }) });
  assert.deepEqual(await projects.addProjects(["/notes.txt", "/gone"]), [
    { status: "failed", path: "/notes.txt", reason: "not-a-directory" },
    { status: "failed", path: "/gone", reason: "unreadable" },
  ]);
  assert.deepEqual(projects.listProjects(), []);
});

test("a share that does not answer is unknown, as the disk says, and an id not tracked is left out", async () => {
  const projects = store({
    disk: fakeDisk(["/share", "/local"], { probes: { "/share": "unknown" } }),
  });
  await projects.addProjects(["/share", "/local"]);
  assert.deepEqual(
    await projects.checkAvailability(["project-1", "project-2", "nope"]),
    { "project-1": "unknown", "project-2": "available" },
  );
});

test("relocating keeps the id, and refuses a directory already tracked", async () => {
  const projects = store({ disk: fakeDisk(["/a", "/b", "/c"]) });
  await projects.addProjects(["/a", "/b"]);
  await assert.rejects(
    projects.relocateProject("project-1", "/b"),
    /already tracked as "b"/,
  );
  const moved = await projects.relocateProject("project-1", "/c");
  assert.equal(moved?.id, "project-1");
  assert.equal(moved?.path, "/c");
});
