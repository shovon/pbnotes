/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Availability, Project } from "../../../../shared/projects.ts";
import { createOpenProject } from "./open-project.ts";
import type { Probe, Registry } from "./open-project.ts";

/**
 * The composition root for these tests: a registry held in memory, with a
 * clock of its own that only moves when a project is opened, and a disk that
 * says whatever reachability a test says, keyed by project id, and records
 * every directory it was asked about.
 *
 * It holds more than `Registry` asks for: a `probe` and what it was asked.
 * `createOpenProject` takes it as a `Registry` all the same, and never sees
 * the rest.
 */
function registry(
  ids: string[],
  reachable: Record<string, Availability> = {},
): Registry & {
  reachable: Record<string, Availability>;
  probe: Probe;
  probed: string[];
} {
  const probed: string[] = [];
  const rows = new Map<string, Project>(
    ids.map((id): [string, Project] => [
      id,
      {
        id,
        path: `/projects/${id}`,
        name: id,
        addedAt: "2026-10-01T00:00:00.000Z",
        lastOpenedAt: null,
        pinned: false,
      },
    ]),
  );
  let tick = 0;
  return {
    reachable,
    getProject: (id) => rows.get(id) ?? null,
    listProjects: () => [...rows.values()],
    touchProject(id) {
      const project = rows.get(id);
      if (!project) return null;
      tick += 1;
      project.lastOpenedAt = `2026-10-27T00:00:${String(tick).padStart(2, "0")}.000Z`;
      return project;
    },
    removeProject: (id) => void rows.delete(id),
    probed,
    async probe(directory) {
      probed.push(directory);
      return reachable[directory.slice("/projects/".length)] ?? "available";
    },
  };
}

/**
 * What is open over `projects`, reached through its own disk, with a ledger
 * that opens for every project but those in `refused`, which it refuses by
 * name. `loaded` is every project it was asked to open.
 */
const openOver = (
  projects: ReturnType<typeof registry>,
  onMoved: () => void,
  refused: string[] = [],
  loaded: string[] = [],
) =>
  createOpenProject(
    projects,
    projects.probe,
    async (project) => {
      loaded.push(project.id);
      if (refused.includes(project.id)) throw new Error(`${project.id} is not a ledger`);
    },
    onMoved,
  );

/** How many times the open project changed. */
function counter(): { count: number; onMoved: () => void } {
  const moved = {
    count: 0,
    onMoved: (): void => {
      moved.count += 1;
    },
  };
  return moved;
}

/** For a test that does not ask whether the open project changed. */
const unwatched = (): void => undefined;

test("with nothing tracked, nothing is open", async () => {
  const open = openOver(registry([]), unwatched);
  assert.equal(open.currentProject(), null);
  await assert.rejects(open.requireProject(), /No project is open/);
});

test("with nothing opened this session, nothing is open, however recently one was", async () => {
  const projects = registry(["a", "b"]);
  projects.touchProject("a");
  const open = openOver(projects, unwatched);
  assert.equal(open.currentProject(), null);
  await assert.rejects(open.requireProject(), /No project is open/);
});

test("opening a project opens its ledger, makes it current and records when", async () => {
  const projects = registry(["a", "b"]);
  const loaded: string[] = [];
  const open = openOver(projects, unwatched, [], loaded);
  await open.open("a");
  assert.equal(open.currentProject()?.id, "a");
  assert.deepEqual(loaded, ["a"]);
  assert.notEqual(projects.getProject("a")?.lastOpenedAt, null);
});

test("opening an id the registry does not track rejects and moves nothing", async () => {
  const moved = counter();
  const open = openOver(registry(["a"]), moved.onMoved);
  await open.open("a");
  moved.count = 0;
  await assert.rejects(open.open("nope"), /No such project/);
  assert.equal(open.currentProject()?.id, "a");
  assert.equal(moved.count, 0);
});

test("opening a project whose folder can't be reached rejects by name, and never opens its ledger", async () => {
  const projects = registry(["a", "b", "c"], { b: "missing", c: "unknown" });
  const loaded: string[] = [];
  const moved = counter();
  const open = openOver(projects, moved.onMoved, [], loaded);
  await open.open("a");
  moved.count = 0;
  await assert.rejects(open.open("b"), /"b" is not reachable right now/);
  await assert.rejects(open.open("c"), /"c" is not reachable right now/);
  assert.equal(open.currentProject()?.id, "a");
  assert.deepEqual(loaded, ["a"]);
  assert.equal(moved.count, 0);
});

test("opening a project whose ledger is refused rejects with why, and leaves the open one, unrecorded", async () => {
  const projects = registry(["a", "b"]);
  const moved = counter();
  const open = openOver(projects, moved.onMoved, ["b"]);
  await open.open("a");
  moved.count = 0;
  await assert.rejects(open.open("b"), /b is not a ledger/);
  assert.equal(open.currentProject()?.id, "a");
  assert.equal(projects.getProject("b")?.lastOpenedAt, null);
  assert.equal(moved.count, 0);
});

test("of two opens in flight, the one asked for last wins", async () => {
  const open = openOver(registry(["a", "b"]), unwatched);
  const first = open.open("a");
  const second = open.open("b");
  await Promise.all([first, second]);
  assert.equal(open.currentProject()?.id, "b");
});

test("the open project changing is told once, and reopening it is not a change", async () => {
  const moved = counter();
  const open = openOver(registry(["a", "b"]), moved.onMoved);
  await open.open("a");
  assert.equal(moved.count, 1);
  await open.open("b");
  assert.equal(moved.count, 2);
  await open.open("b");
  assert.equal(moved.count, 2);
});

test("removing the open project leaves none open", async () => {
  const moved = counter();
  const open = openOver(registry(["a", "b", "c"]), moved.onMoved);
  await open.open("a");
  await open.open("b");
  moved.count = 0;
  open.remove("b");
  assert.equal(open.currentProject(), null);
  assert.equal(moved.count, 1);
});

test("removing a project that is not open moves nothing", async () => {
  const moved = counter();
  const open = openOver(registry(["a", "b"]), moved.onMoved);
  await open.open("a");
  moved.count = 0;
  open.remove("b");
  assert.equal(open.currentProject()?.id, "a");
  assert.equal(moved.count, 0);
});

test("an open project that stops being reachable is refused, by name", async () => {
  const projects = registry(["a"]);
  const open = openOver(projects, unwatched);
  await open.open("a");
  projects.reachable.a = "missing";
  await assert.rejects(open.requireProject(), /"a" is not reachable right now/);
  projects.reachable.a = "unknown";
  await assert.rejects(open.requireProject(), /"a" is not reachable right now/);
  projects.reachable.a = "available";
  assert.equal((await open.requireProject()).id, "a");
});

test("requireProject settles which project the moment it is called", async () => {
  const open = openOver(registry(["a", "b"]), unwatched);
  await open.open("a");
  // A write sent just before the project changed lands where it was typed.
  const pending = open.requireProject();
  await open.open("b");
  assert.equal((await pending).id, "a");
  assert.equal((await open.requireProject()).id, "b");
});

test("requireProject asks the disk about the open project's own folder, and only that", async () => {
  const projects = registry(["a", "b"]);
  const open = openOver(projects, unwatched);
  await open.open("b");
  projects.probed.length = 0;
  await open.requireProject();
  assert.deepEqual(projects.probed, ["/projects/b"]);

  const empty = registry([]);
  await assert.rejects(openOver(empty, unwatched).requireProject());
  assert.deepEqual(empty.probed, []);
});
