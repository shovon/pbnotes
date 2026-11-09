/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { step } from "./alt.ts";
import type { Input } from "./alt.ts";

type Mods = Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "repeat", boolean>>;
const down = (key: string, mods: Mods = {}): Input => ({
  type: "keydown",
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  repeat: false,
  ...mods,
});
const up = (key: string, mods: Mods = {}): Input => ({ ...down(key, mods), type: "keyup" }) as Input;
const cancel: Input = { type: "cancel" };

/** Runs `inputs` from rest and says at which of them the menu opens. */
const opensAt = (...inputs: Input[]) => {
  let armed = false;
  const at: number[] = [];
  inputs.forEach((input, i) => {
    const next = step(armed, input);
    armed = next.armed;
    if (next.open) at.push(i);
  });
  return at;
};

test("Alt pressed and let go alone opens the menu, on letting go", () => {
  assert.deepEqual(opensAt(down("Alt"), up("Alt")), [1]);
});

test("held down, Alt repeats and still opens the menu once, on letting go", () => {
  assert.deepEqual(opensAt(down("Alt"), down("Alt", { repeat: true }), down("Alt", { repeat: true }), up("Alt")), [3]);
});

test("another key while Alt is down is a shortcut, not the menu", () => {
  assert.deepEqual(opensAt(down("Alt"), down("F4"), up("F4"), up("Alt")), []);
  assert.deepEqual(opensAt(down("Alt"), down("ArrowLeft"), up("Alt")), []);
});

test("AltGr, which Windows reports as Ctrl+Alt, types a character and opens nothing", () => {
  // As Chromium on Windows sends it: Ctrl first, then Alt with Ctrl held.
  assert.deepEqual(opensAt(down("Control", { ctrlKey: true }), down("Alt", { ctrlKey: true }), down("@", { ctrlKey: true }), up("Alt", { ctrlKey: true }), up("Control")), []);
  // AltGr let go with no character typed is still not Alt alone.
  assert.deepEqual(opensAt(down("Control", { ctrlKey: true }), down("Alt", { ctrlKey: true }), up("Control"), up("Alt")), []);
});

test("Alt with Ctrl, Meta or Shift opens nothing, whichever went down first", () => {
  for (const mod of ["ctrlKey", "metaKey", "shiftKey"] as const) {
    assert.deepEqual(opensAt(down("Alt", { [mod]: true }), up("Alt")), [], mod);
  }
  assert.deepEqual(opensAt(down("Alt"), down("Shift", { shiftKey: true }), up("Shift"), up("Alt")), []);
  assert.deepEqual(opensAt(down("Alt"), down("Control", { ctrlKey: true }), up("Control"), up("Alt")), []);
});

test("a repeat of Alt after another key does not arm it again", () => {
  assert.deepEqual(opensAt(down("Alt"), down("Tab"), down("Alt", { repeat: true }), up("Alt")), []);
});

test("a click or the window losing focus while Alt is down ends it", () => {
  assert.deepEqual(opensAt(down("Alt"), cancel, up("Alt")), []);
});

test("letting go of Alt that was never pressed here opens nothing", () => {
  // Alt+Tab back into the window: the press went to the window left.
  assert.deepEqual(opensAt(up("Alt")), []);
});

test("each lone press opens it again", () => {
  assert.deepEqual(opensAt(down("Alt"), up("Alt"), down("x"), up("x"), down("Alt"), up("Alt")), [1, 5]);
});
