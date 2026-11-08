/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { iconSlots, recentEmoji } from "./icon-slots.ts";

test("recent emoji keeps a list of short strings, as a copy", () => {
  const raw = ["🌲", "📚"];
  const kept = recentEmoji.decode(raw);
  assert.deepEqual(kept, ["🌲", "📚"]);
  assert.notEqual(kept, raw);
});

test("recent emoji refuses anything else", () => {
  for (const raw of [undefined, null, "🌲", [1], ["🌲", null], ["x".repeat(65)], Array(101).fill("🌲")]) {
    assert.equal(recentEmoji.decode(raw), undefined, JSON.stringify(raw)?.slice(0, 40));
  }
});

test("the slot is named as the renderer names it", () => {
  assert.deepEqual([...iconSlots.keys()], ["recent-emoji"]);
});
