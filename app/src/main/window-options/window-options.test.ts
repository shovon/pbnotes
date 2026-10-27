import { test } from "node:test";
import assert from "node:assert/strict";
import { mainWindowOptions } from "./window-options.ts";

test("uses the given preload with isolation and sandbox on", () => {
  assert.deepEqual(mainWindowOptions({ preload: "/p.js" }).webPreferences, {
    preload: "/p.js",
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  });
});
