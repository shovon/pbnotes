/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTokens } from "./tokens.ts";

const counting = (keep: number) => {
  let n = 0;
  return createTokens<string>({ newId: () => `t${++n}`, keep });
};

test("a token stands for what it was lent for, and one never lent for nothing", () => {
  const tokens = counting(5);
  const a = tokens.lend("A");
  assert.equal(tokens.find(a), "A");
  assert.equal(tokens.find("made-up"), undefined);
  assert.equal(tokens.find(a), "A", "finding does not use it up");
});

test("only the latest few are kept", () => {
  const tokens = counting(2);
  const [a, b, c] = ["A", "B", "C"].map((it) => tokens.lend(it));
  assert.equal(tokens.find(a), undefined);
  assert.equal(tokens.find(b), "B");
  assert.equal(tokens.find(c), "C");
});
