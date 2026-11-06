/**
 * Run with: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as forest from "./forest.ts";
import type { Forest, Spot } from "./forest.ts";

/** A tree as nested arrays: what a forest holds, read out. */
type Tree = [string, Tree[]];

function grown(f: Forest, ids: readonly string[]): Tree[] {
  return ids.map((id) => [id, grown(f, forest.childrenOf(f, id))]);
}

/** Every group and its trees, by group name, and every row checked against the lists. */
function read(f: Forest): Record<string, Tree[]> {
  const out: Record<string, Tree[]> = {};
  for (const group of [...forest.groups(f)].sort()) out[group] = grown(f, forest.rootsOf(f, group));
  // Each node is in exactly the list its row says, in its row's group.
  let seen = 0;
  for (const group of forest.groups(f)) {
    for (const id of forest.inGroup(f, group)) {
      seen++;
      const row = forest.node(f, id)!;
      assert.equal(row.group, group, `${id}'s group`);
      const list = row.parent === undefined ? forest.rootsOf(f, group) : forest.childrenOf(f, row.parent);
      assert.ok(list.includes(id), `${id} is in its list`);
    }
  }
  assert.equal(seen, f.nodes.size, "every node is in some group's trees");
  return out;
}

/** The same forest as nested arrays, changed in place: slow and obviously right. */
class Model {
  groups = new Map<string, Tree[]>();
  #find(id: string, trees?: Tree[], group?: string): { list: Tree[]; at: number; group: string } | undefined {
    for (const [g, roots] of trees ? [[group!, trees] as const] : this.groups) {
      const at = roots.findIndex(([it]) => it === id);
      if (at !== -1) return { list: roots, at, group: g };
      for (const [, kids] of roots) {
        const hit = this.#find(id, kids, g);
        if (hit) return hit;
      }
    }
    return undefined;
  }
  has(id: string) {
    return !!this.#find(id);
  }
  within(id: string, root: string): boolean {
    const hit = this.#find(root);
    const look = (tree: Tree): boolean => tree[0] === id || tree[1].some(look);
    return !!hit && look(hit.list[hit.at]);
  }
  #place(tree: Tree, spot: Spot) {
    if ("after" in spot) {
      const hit = this.#find(spot.after)!;
      hit.list.splice(hit.at + 1, 0, tree);
    } else if ("under" in spot) {
      const hit = this.#find(spot.under)!;
      const kids = hit.list[hit.at][1];
      if (spot.at === "first") kids.unshift(tree);
      else kids.push(tree);
    } else {
      if (!this.groups.has(spot.group)) this.groups.set(spot.group, []);
      const roots = this.groups.get(spot.group)!;
      if (spot.at === "first") roots.unshift(tree);
      else roots.push(tree);
    }
  }
  add(id: string, spot: Spot) {
    this.#place([id, []], spot);
  }
  move(id: string, spot: Spot) {
    const hit = this.#find(id)!;
    const [tree] = hit.list.splice(hit.at, 1);
    this.#place(tree, spot);
  }
  removeTree(id: string) {
    const hit = this.#find(id);
    if (hit) hit.list.splice(hit.at, 1);
  }
  dropGroup(group: string) {
    this.groups.delete(group);
  }
  read(): Record<string, Tree[]> {
    const out: Record<string, Tree[]> = {};
    for (const group of [...this.groups.keys()].sort()) out[group] = structuredClone(this.groups.get(group)!);
    return out;
  }
}

function random(seed: number) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

test("agrees with nested arrays over many random writes", () => {
  for (const seed of [1, 2, 3, 4]) {
    const next = random(seed);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)];
    const groups = ["a", "b", "c"];
    let f = forest.empty();
    const model = new Model();
    let made = 0;
    for (let step = 0; step < 3000; step++) {
      const ids = [...forest.groups(f)].flatMap((g) => forest.inGroup(f, g));
      const spotFor = (): Spot => {
        const r = next();
        if (ids.length === 0 || r < 0.25) return { group: pick(groups), at: next() < 0.5 ? "first" : "last" };
        if (r < 0.65) return { after: pick(ids) };
        return { under: pick(ids), at: next() < 0.5 ? "first" : "last" };
      };
      const r = next();
      if (ids.length === 0 || r < 0.45) {
        const id = `n${made++}`;
        const spot = spotFor();
        f = forest.add(f, id, spot);
        model.add(id, spot);
      } else if (r < 0.8) {
        const id = pick(ids);
        const spot = spotFor();
        const ref = "after" in spot ? spot.after : "under" in spot ? spot.under : undefined;
        if (ref !== undefined && model.within(ref, id)) {
          assert.equal(forest.move(f, id, spot), f);
          continue;
        }
        f = forest.move(f, id, spot);
        model.move(id, spot);
      } else if (r < 0.97) {
        const id = pick(ids);
        f = forest.removeTree(f, id);
        model.removeTree(id);
      } else {
        const group = pick(groups);
        f = forest.dropGroup(f, group);
        model.dropGroup(group);
      }
      if (step % 50 === 0) assert.deepEqual(read(f), model.read(), `seed ${seed}, step ${step}`);
    }
    assert.deepEqual(read(f), model.read(), `seed ${seed}, at the end`);
  }
});

test("never changes the forest it was handed", () => {
  let f = forest.empty();
  f = forest.add(f, "a", { group: "g", at: "last" });
  f = forest.add(f, "b", { under: "a", at: "last" });
  f = forest.add(f, "c", { after: "a" });
  const copy = structuredClone(f);
  forest.add(f, "d", { after: "b" });
  forest.move(f, "c", { under: "b", at: "first" });
  forest.move(f, "a", { group: "h", at: "first" });
  forest.removeTree(f, "a");
  forest.dropGroup(f, "g");
  assert.deepEqual(f, copy);
});

test("a subtree moved to another group takes the group, all the way down", () => {
  let f = forest.empty();
  f = forest.add(f, "a", { group: "g", at: "last" });
  f = forest.add(f, "b", { under: "a", at: "last" });
  f = forest.add(f, "c", { under: "b", at: "last" });
  f = forest.move(f, "a", { group: "h", at: "last" });
  assert.deepEqual(["a", "b", "c"].map((id) => forest.node(f, id)!.group), ["h", "h", "h"]);
  assert.deepEqual(forest.rootsOf(f, "g"), []);
  assert.equal(forest.hasGroup(f, "g"), true, "the group it left stands, empty");
});

test("a write it cannot do leaves the forest as it was, and never throws", () => {
  // A fold that throws fails the open for the whole folder (DNA.md).
  let f = forest.empty();
  f = forest.add(f, "a", { group: "g", at: "last" });
  f = forest.add(f, "b", { under: "a", at: "last" });
  assert.equal(forest.move(f, "a", { under: "b", at: "last" }), f, "inside its own subtree");
  assert.equal(forest.move(f, "a", { after: "a" }), f, "after itself");
  assert.equal(forest.move(f, "a", { after: "nobody" }), f, "beside a node that is not there");
  assert.equal(forest.move(f, "nobody", { group: "g", at: "first" }), f, "a node that is not there");
  assert.equal(forest.add(f, "b", { group: "g", at: "first" }), f, "an id already there");
  assert.equal(forest.add(f, "z", { after: "nobody" }), f, "beside a node that is not there");
  assert.equal(forest.add(f, "z", { under: "nobody", at: "first" }), f, "under a node that is not there");
});

test("the same trees are the same data, however they came to be", () => {
  let built = forest.empty();
  built = forest.add(built, "a", { group: "g", at: "last" });
  built = forest.add(built, "b", { after: "a" });
  built = forest.add(built, "c", { under: "a", at: "last" });

  let roundabout = forest.empty();
  roundabout = forest.add(roundabout, "b", { group: "h", at: "last" });
  roundabout = forest.add(roundabout, "x", { under: "b", at: "first" });
  roundabout = forest.add(roundabout, "c", { after: "x" });
  roundabout = forest.add(roundabout, "a", { group: "g", at: "first" });
  roundabout = forest.move(roundabout, "c", { under: "a", at: "first" });
  roundabout = forest.removeTree(roundabout, "x");
  roundabout = forest.move(roundabout, "b", { after: "a" });
  roundabout = forest.dropGroup(roundabout, "h");
  assert.deepEqual(roundabout, built);
});

test("survives a structured clone as itself", () => {
  let f = forest.empty();
  f = forest.add(f, "a", { group: "__proto__", at: "last" });
  f = forest.add(f, "b", { under: "a", at: "first" });
  const cloned = structuredClone(f);
  assert.deepEqual(cloned, f);
  assert.deepEqual(forest.childrenOf(cloned, "a"), ["b"]);
});
