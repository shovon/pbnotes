/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawable } from './drawable.ts';

test('one emoji is drawn, however many code points it takes', () => {
  for (const icon of ['🌲', '❤️', '👩‍💻', '👍🏽', '🇫🇷', '🏳️‍🌈', '1️⃣', '#️⃣', '©️']) {
    assert.equal(drawable(icon), icon, icon);
  }
});

test('nothing, more than one emoji, text or an icon this build does not know is not drawn', () => {
  for (const icon of [undefined, null, '', ' ', '🌲🌲', '🌲 ', 'a', 'ab', '1', 'image:abc123', '🇫']) {
    assert.equal(drawable(icon), undefined, JSON.stringify(icon));
  }
});
