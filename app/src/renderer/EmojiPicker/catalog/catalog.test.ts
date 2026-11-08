/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalog, NEWEST, randomOf, recentOf, search, sections } from './catalog.ts';
import type { Source } from './catalog.ts';

/** A few emoji as emojibase has them, out of order on purpose. */
const DATA: Source[] = [
  { emoji: '🌲', label: 'evergreen tree', tags: ['tree', 'pine'], group: 3, order: 30, version: 1 },
  { emoji: '😀', label: 'grinning face', tags: ['face', 'grin', 'happy'], group: 0, order: 1, version: 1 },
  { emoji: '😊', label: 'smiling face with smiling eyes', tags: ['blush', 'happy'], group: 0, order: 2, version: 0.6 },
  { emoji: '🌳', label: 'deciduous tree', tags: ['tree'], group: 3, order: 31, version: 1 },
  { emoji: '🏻', label: 'light skin tone', tags: [], group: 2, order: 500, version: 1 },
  { emoji: '🇦', label: 'regional indicator A', version: 2 },
  { emoji: '🫨', label: 'shaking face', tags: ['earthquake'], group: 0, order: 3, version: 16 },
  { emoji: '🇫🇷', label: 'flag: France', tags: ['FR'], group: 9, order: 900, version: 2 },
];

const ALL = catalog(DATA);
const emoji = (entries: { emoji: string }[]) => entries.map((it) => it.emoji);

test('the catalog is every emoji in a group, up to the newest version, in order', () => {
  assert.deepEqual(emoji(ALL), ['😀', '😊', '🌲', '🌳', '🇫🇷']);
  assert.deepEqual(emoji(catalog(DATA, 16)), ['😀', '😊', '🫨', '🌲', '🌳', '🇫🇷']);
  assert.ok(NEWEST < 16, 'nothing newer than the system fonts draw');
});

test('names and keywords are lower case', () => {
  assert.equal(ALL.at(-1)?.label, 'flag: france');
  assert.deepEqual(ALL.at(-1)?.tags, ['fr']);
});

test('sections head each group in order and leave empty ones out', () => {
  assert.deepEqual(
    sections(ALL).map((it) => [it.label, emoji([...it.entries])]),
    [
      ['Smileys & emotion', ['😀', '😊']],
      ['Animals & nature', ['🌲', '🌳']],
      ['Flags', ['🇫🇷']],
    ],
  );
});

test('recent keeps its order, once each, and drops what the catalog lacks', () => {
  assert.deepEqual(emoji(recentOf(ALL, ['🌳', 'image:abc', '😀', '🌳', '🫨'])), ['🌳', '😀']);
  assert.deepEqual(recentOf(ALL, []), []);
});

test('a search matches word starts in the name or a keyword', () => {
  assert.deepEqual(emoji(search(ALL, 'tree')), ['🌲', '🌳']);
  assert.deepEqual(emoji(search(ALL, 'pi')), ['🌲'], 'a keyword');
  assert.deepEqual(emoji(search(ALL, 'ree')), [], 'not the middle of a word');
  assert.deepEqual(emoji(search(ALL, 'fra')), ['🇫🇷'], 'past punctuation');
  assert.deepEqual(emoji(search(ALL, '  ')), []);
});

test('every word has to match, in the name or a keyword', () => {
  assert.deepEqual(emoji(search(ALL, 'smiling eyes')), ['😊']);
  assert.deepEqual(emoji(search(ALL, 'happy face')), ['😀', '😊']);
  assert.deepEqual(emoji(search(ALL, 'tree face')), []);
});

test('a name that starts with the query ranks first, then a name match, then keywords', () => {
  // "grinning face" starts with "grin"; nothing else does.
  assert.deepEqual(emoji(search(ALL, 'GRIN')), ['😀']);
  // Both names hold "face"; neither starts with "smiling face" but one has both words.
  assert.deepEqual(emoji(search(ALL, 'face smiling')), ['😊']);
  // "happy" is a keyword of both, in catalog order.
  assert.deepEqual(emoji(search(ALL, 'happy')), ['😀', '😊']);
  // "deciduous tree" starts with the query; the evergreen only has a word.
  assert.deepEqual(emoji(search(ALL, 'deciduous')), ['🌳']);
  assert.deepEqual(emoji(search(catalog([...DATA, { emoji: '🎄', label: 'Christmas tree', tags: ['tree'], group: 6, order: 600, version: 1 }]), 'tree')), ['🌲', '🌳', '🎄']);
});

test('randomOf picks by the number it is handed, and nothing from nothing', () => {
  assert.equal(randomOf(ALL, () => 0)?.emoji, '😀');
  assert.equal(randomOf(ALL, () => 0.999)?.emoji, '🇫🇷');
  assert.equal(randomOf(ALL, () => 1)?.emoji, '🇫🇷', 'never past the end');
  assert.equal(randomOf([], () => 0.5), undefined);
});
