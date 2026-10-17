/**
 * What a key does to a `[`/`]` pair in the box, as a replacement of
 * `value[from, to)` with `text` followed by a selection — or null to let the
 * key through. Kept apart from the textarea so the rules can be tested
 * without a DOM; the box applies the edit through `execCommand`, which is
 * what keeps each one a single step of native undo.
 */
export type Edit = { from: number; to: number; text: string; select: [number, number] };

export function bracketEdit(
  key: string,
  value: string,
  start: number,
  end: number,
): Edit | null {
  if (key === '[') {
    // Wrap a selection rather than replace it, and keep it selected, so a
    // second `[` makes it `[[selection]]`.
    const inner = value.slice(start, end);
    return { from: start, to: end, text: `[${inner}]`, select: [start + 1, end + 1] };
  }
  if (start !== end) return null;
  // Typing over the `]` that the `[` already put there.
  if (key === ']' && value[start] === ']') {
    return { from: start, to: start, text: '', select: [start + 1, start + 1] };
  }
  if (key === 'Backspace' && value[start - 1] === '[' && value[start] === ']') {
    return { from: start - 1, to: start + 1, text: '', select: [start - 1, start - 1] };
  }
  return null;
}
