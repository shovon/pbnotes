/**
 * A block whose text starts with a task marker (#376): `TODO`, `DOING` or
 * `DONE`, in capitals, as the first word. The marker is the text's own, so a
 * task is a block like any other and a change of state is an edit of its
 * text; nothing here knows about blocks, only about the string.
 */
export type Marker = "TODO" | "DOING" | "DONE";

/**
 * The marker, then the spaces after it, or a line break or the end of the
 * text. `TODOs` and `todo` are words, not markers.
 */
const MARKED = /^(TODO|DOING|DONE)(?:[ \t]+|(?=\n)|$)/;

/** The marker and the text after it, or `undefined` for text that is not a task. */
export function readTask(text: string): { marker: Marker; rest: string } | undefined {
  const match = MARKED.exec(text);
  if (!match) return undefined;
  return { marker: match[1] as Marker, rest: text.slice(match[0].length) };
}

/**
 * The same text under another marker: the leading one swapped, every other
 * character left as it was. Text that is not a task gets the marker put in
 * front.
 */
export function withMarker(text: string, marker: Marker): string {
  const found = readTask(text);
  return found
    ? marker + text.slice(found.marker.length)
    : `${marker} ${text}`;
}

/** What the checkbox makes it: checked is done, unchecked is to do, whatever it was before. */
export function checked(on: boolean): Marker {
  return on ? "DONE" : "TODO";
}

/** What a click on the label makes it: to do and doing swap. */
export function labelled(marker: "TODO" | "DOING"): Marker {
  return marker === "TODO" ? "DOING" : "TODO";
}
