/**
 * Run with: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalize } from "./canonicalize.ts";

test("canonicalize is exactly the expression the README states", () => {
  // Each pair is one step of the expression. A change to any step fails here,
  // and would regroup pages in every existing folder: see the README.
  const cases: [string, string][] = [
    ["Mira", "mira"], // lowercased
    ["  Mira \n", "mira"], // trimmed
    ["Mi​ra﻿", "mira"], // zero-width space and BOM dropped
    ["a‍b‌c", "a‍b‌c"], // joiner and non-joiner kept
    ["Café", "café"], // NFC
    ["ﬁx²", "ﬁx²"], // not NFKC: ﬁ and ² stay
    ["İ", "i̇"], // locale-free: Turkish İ lowercases the same everywhere
  ];
  for (const [title, canonical] of cases) {
    assert.equal(canonicalize(title), canonical, JSON.stringify(title));
  }
});
