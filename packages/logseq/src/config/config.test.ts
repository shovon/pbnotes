/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, readConfig } from "./config.ts";

test("the three keys, as a graph made by recent Logseq writes them", () => {
  const text = `{:meta/version 1
 ;; comment
 :journal/page-title-format "EEE do, MMM yyyy"
 :journal/file-name-format "yyyy-MM-dd"
 :file/name-format :triple-lowbar
 :feature/enable-journals? true}`;
  assert.deepEqual(readConfig(text), {
    fileNames: "triple-lowbar",
    journalFiles: "yyyy-MM-dd",
    journalTitles: "EEE do, MMM yyyy",
  });
});

test("a key that is commented out, or absent, is Logseq's default", () => {
  const text = `{;; :file/name-format :triple-lowbar
 ; :journal/page-title-format "yyyy"
 :ui/theme "dark ; not a comment"}`;
  assert.deepEqual(readConfig(text), DEFAULTS);
  assert.deepEqual(readConfig(""), DEFAULTS);
  assert.deepEqual(readConfig("not edn at all {{{"), DEFAULTS);
});

test("a ; inside a string does not hide the key after it", () => {
  const text = `{:x "a;b" :file/name-format :triple-lowbar}`;
  assert.equal(readConfig(text).fileNames, "triple-lowbar");
});
