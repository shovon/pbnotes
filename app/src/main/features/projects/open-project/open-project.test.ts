/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Availability, Project } from "../../../../shared/projects.ts";
import { createOpenProject } from "./open-project.ts";
import type { Registry } from "./open-project.ts";

/**
 * The composition root for these tests: a registry held in memory, with a
 * clock of its own that only moves when a project is opened, and whatever
 * reachability a test says.
 */
function registry(
  ids: string[],
  reachable: Record<string, Availability> = {},
): Registry & { reachable: Record<string, Availability> } {
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
    async checkAvailability(asked) {
      return Object.fromEntries(
        asked
          .filter((id) => rows.has(id))
          .map((id) => [id, reachable[id] ?? "available"]),
      );
    },
  };
}

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
  const open = createOpenProject(registry([]), unwatched);
  assert.equal(open.currentProject(), null);
  await assert.rejects(open.requireProject(), /No project is open/);
});

test("with nothing opened this session, the most recently opened one is", () => {
  const projects = registry(["a", "b", "c"]);
  projects.touchProject("a");
  projects.touchProject("c");
  projects.touchProject("b");
  const open = createOpenProject(projects, unwatched);
  assert.equal(open.currentProject()?.id, "b");
});

test("opening a project makes it current and records when", () => {
  const projects = registry(["a", "b"]);
  const open = createOpenProject(projects, unwatched);
  open.open("a");
  assert.equal(open.currentProject()?.id, "a");
  assert.notEqual(projects.getProject("a")?.lastOpenedAt, null);
});

test("opening an id the registry does not track throws and moves nothing", () => {
  const moved = counter();
  const open = createOpenProject(registry(["a"]), moved.onMoved);
  open.open("a");
  moved.count = 0;
  assert.throws(() => open.open("nope"), /No such project/);
  assert.equal(open.currentProject()?.id, "a");
  assert.equal(moved.count, 0);
});

test("the open project changing is told once, and reopening it is not a change", () => {
  const moved = counter();
  const open = createOpenProject(registry(["a", "b"]), moved.onMoved);
  open.open("a");
  // Nothing was open but the fallback, and with nothing opened before that is
  // whichever the registry lists first; `a` may already be it.
  moved.count = 0;
  open.open("b");
  assert.equal(moved.count, 1);
  open.open("b");
  assert.equal(moved.count, 1);
});

test("removing the open project moves to the next most recent", () => {
  const moved = counter();
  const open = createOpenProject(registry(["a", "b", "c"]), moved.onMoved);
  open.open("a");
  open.open("b");
  moved.count = 0;
  open.remove("b");
  assert.equal(open.currentProject()?.id, "a");
  assert.equal(moved.count, 1);
});

test("removing a project that is not open moves nothing", () => {
  const moved = counter();
  const open = createOpenProject(registry(["a", "b"]), moved.onMoved);
  open.open("a");
  moved.count = 0;
  open.remove("b");
  assert.equal(open.currentProject()?.id, "a");
  assert.equal(moved.count, 0);
});

test("a project that cannot be reached is refused, by name", async () => {
  const projects = registry(["a", "b"], { a: "missing", b: "unknown" });
  const open = createOpenProject(projects, unwatched);
  open.open("a");
  await assert.rejects(open.requireProject(), /"a" is not reachable right now/);
  open.open("b");
  await assert.rejects(open.requireProject(), /"b" is not reachable right now/);
  projects.reachable.b = "available";
  assert.equal((await open.requireProject()).id, "b");
});

test("requireProject settles which project the moment it is called", async () => {
  const open = createOpenProject(registry(["a", "b"]), unwatched);
  open.open("a");
  // A write sent just before the project changed lands where it was typed.
  const pending = open.requireProject();
  open.open("b");
  assert.equal((await pending).id, "a");
  assert.equal((await open.requireProject()).id, "b");
});
