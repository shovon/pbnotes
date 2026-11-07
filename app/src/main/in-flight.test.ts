/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createInFlight } from "./in-flight.ts";

/** A promise the test resolves or rejects when it says. */
function later<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>(
    (res, rej) => ((resolve = res), (reject = rej)),
  );
  return { promise, resolve, reject };
}

/** Whether `promise` has settled once everything queued so far has run. */
async function isDone(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  void promise.then(() => (done = true));
  await new Promise((r) => setImmediate(r));
  return done;
}

test("settled waits for every piece of work tracked before it, a failed one included", async () => {
  const inFlight = createInFlight();
  const ok = later<number>();
  const failed = later<number>();
  inFlight.track(ok.promise);
  inFlight.track(failed.promise).catch((): void => undefined);
  const settled = inFlight.settled();

  ok.resolve(1);
  assert.equal(
    await isDone(settled),
    false,
    "settled before the failed one finished",
  );
  failed.reject(new Error("no"));
  assert.equal(await isDone(settled), true);
});

test("settled does not wait for work tracked after it", async () => {
  const inFlight = createInFlight();
  const settled = inFlight.settled();
  inFlight.track(later<void>().promise);
  assert.equal(await isDone(settled), true);
});

test("track hands back the work as it was, value or failure", async () => {
  const inFlight = createInFlight();
  assert.equal(await inFlight.track(Promise.resolve(7)), 7);
  await assert.rejects(inFlight.track(Promise.reject(new Error("no"))), /no/);
});

test("finished work is not waited on again", async () => {
  const inFlight = createInFlight();
  await inFlight.track(Promise.resolve());
  assert.equal(await isDone(inFlight.settled()), true);
});
