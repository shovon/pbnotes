/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHeard } from "./heard.ts";

test("a reply that arrives before its state waits for it", async () => {
  const heard = createHeard<string>();
  const log: string[] = [];
  heard.listen((state) => log.push(`heard ${state}`));

  // The first send to a frame: Electron hands over the reply first.
  const call = heard.until(1).then(() => log.push("resolved"));
  await Promise.resolve();
  assert.deepEqual(log, []);

  heard.deliver("a", 1);
  await call;
  assert.deepEqual(log, ["heard a", "resolved"]);
});

test("a reply that arrives after its state resolves at once", async () => {
  const heard = createHeard<string>();
  const log: string[] = [];
  heard.listen((state) => log.push(`heard ${state}`));
  heard.deliver("a", 1);
  heard.deliver("b", 2);
  await heard.until(1);
  await heard.until(2);
  assert.deepEqual(log, ["heard a", "heard b"]);
});

test("a call waits for its own state, not just any", async () => {
  const heard = createHeard<string>();
  let done = false;
  const call = heard.until(2).then(() => (done = true));
  heard.deliver("a", 1);
  await Promise.resolve();
  assert.equal(done, false);
  heard.deliver("b", 2);
  await call;
  assert.equal(done, true);
});

test("a later state settles a call waiting on an earlier one", async () => {
  // A window reloaded mid-session hears numbers main kept counting, so the
  // first one it hears can be past what an older call was told.
  const heard = createHeard<string>();
  const call = heard.until(3);
  heard.deliver("c", 7);
  await call;
});

test("a call that sent nothing does not wait", async () => {
  await createHeard<string>().until(undefined);
});

test("an unsubscribed listener hears nothing more", () => {
  const heard = createHeard<string>();
  const log: string[] = [];
  const off = heard.listen((state) => log.push(state));
  heard.deliver("a", 1);
  off();
  heard.deliver("b", 2);
  assert.deepEqual(log, ["a"]);
});

test("a listener that throws does not leave a call hanging", async () => {
  const heard = createHeard<string>();
  heard.listen(() => {
    throw new Error("listener");
  });
  const call = heard.until(1);
  assert.throws(() => heard.deliver("a", 1), /listener/);
  await call;
});
