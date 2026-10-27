import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mainWindowOptions, windowColors } from "./window-options.ts";

test("uses the given preload with isolation and sandbox on", () => {
  assert.deepEqual(mainWindowOptions({ preload: "/p.js" }).webPreferences, {
    preload: "/p.js",
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  });
});

// The main process cannot read the renderer's tokens, so the colours are
// repeated; this is what keeps the two copies from drifting apart.
const css = readFileSync(
  fileURLToPath(new URL("../../renderer/index.css", import.meta.url)),
  "utf8",
);
const token = (block: string, name: string): string => {
  const found = new RegExp(`--color-${name}:\\s*(#[0-9a-f]+);`, "i").exec(block);
  assert.ok(found, `--color-${name} not found`);
  return found[1].toLowerCase();
};
const light = css.slice(css.indexOf("@theme"), css.indexOf("@media (prefers-color-scheme: dark)"));
const dark = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"));

for (const [scheme, block, isDark] of [
  ["light", light, false],
  ["dark", dark, true],
] as const) {
  test(`window colours match the renderer's ${scheme} tokens`, () => {
    const bg = token(block, "bg");
    assert.deepEqual(windowColors(isDark), {
      backgroundColor: bg,
      titleBarOverlay: { color: bg, symbolColor: token(block, "fg") },
    });
  });
}
