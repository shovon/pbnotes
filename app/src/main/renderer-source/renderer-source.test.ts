import { test } from "node:test";
import assert from "node:assert/strict";
import { rendererSource } from "./renderer-source.ts";

test("prefers the dev server URL", () => {
  assert.deepEqual(rendererSource("http://localhost:5173", "/index.html"), {
    kind: "url",
    url: "http://localhost:5173",
  });
});

test("falls back to the built file", () => {
  assert.deepEqual(rendererSource(undefined, "/index.html"), { kind: "file", path: "/index.html" });
  assert.deepEqual(rendererSource("", "/index.html"), { kind: "file", path: "/index.html" });
});
