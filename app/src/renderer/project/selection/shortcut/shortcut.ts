/**
 * The keys and clicks that select blocks (#253), as Logseq has them: Cmd on
 * macOS, Ctrl elsewhere, and only the platform's own, so Ctrl+A on a Mac
 * stays go-to-line-start in a block being written.
 *
 * Pure, and told the platform rather than reading it, so it runs under
 * `node --test`. `ProjectView` and the block box listen for the keys.
 */

/** The modifiers on a key press or a click. */
export type Mods = {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

export type Press = Mods & { key: string };

/** What a key does to a selection that exists. */
export type Command =
  | { kind: "move"; by: 1 | -1 }
  | { kind: "extend"; by: 1 | -1 }
  | { kind: "open" }
  | { kind: "clear" }
  | { kind: "all" }
  | { kind: "delete" }
  | { kind: "indent" }
  | { kind: "outdent" };

/** The platform's own modifier, and no other. */
function platform(mods: Mods, mac: boolean): boolean {
  const modifier = mac ? mods.metaKey && !mods.ctrlKey : mods.ctrlKey && !mods.metaKey;
  return modifier && !mods.altKey && !mods.shiftKey;
}

/** No modifier at all. */
function bare(mods: Mods): boolean {
  return !mods.metaKey && !mods.ctrlKey && !mods.altKey && !mods.shiftKey;
}

/** Shift, and nothing else. */
function shifted(mods: Mods): boolean {
  return mods.shiftKey && !mods.metaKey && !mods.ctrlKey && !mods.altKey;
}

const ARROWS: Record<string, 1 | -1> = { ArrowUp: -1, ArrowDown: 1 };

/** Whether a click adds a block to the selection, or takes it out: Cmd+click, Ctrl+click elsewhere. */
export function picks(click: Mods, mac: boolean): boolean {
  return platform(click, mac);
}

/** Whether a key press is select all: Cmd+A, Ctrl+A elsewhere. */
export function selectsAll(press: Press, mac: boolean): boolean {
  return platform(press, mac) && press.key.toLowerCase() === "a";
}

/** Shift+Up (`-1`) or Shift+Down (`1`), or undefined for any other press. */
export function extendsBy(press: Press): 1 | -1 | undefined {
  return shifted(press) ? ARROWS[press.key] : undefined;
}

/** What a key press does with blocks selected, or undefined when it is not one of the keys. */
export function command(press: Press, mac: boolean): Command | undefined {
  const by = ARROWS[press.key];
  if (by && bare(press)) return { kind: "move", by };
  if (by && shifted(press)) return { kind: "extend", by };
  if (press.key === "Enter" && bare(press)) return { kind: "open" };
  if (press.key === "Escape" && bare(press)) return { kind: "clear" };
  if (selectsAll(press, mac)) return { kind: "all" };
  // Either key, as in Logseq: a Mac keyboard's delete key is Backspace.
  if ((press.key === "Backspace" || press.key === "Delete") && bare(press)) return { kind: "delete" };
  if (press.key === "Tab" && bare(press)) return { kind: "indent" };
  if (press.key === "Tab" && shifted(press)) return { kind: "outdent" };
  return undefined;
}
