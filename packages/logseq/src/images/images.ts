/**
 * Links to a Logseq graph's `assets/` folder in a block's text: finding
 * them, and writing a block back with some of them swapped.
 *
 * `![alt](../assets/foo.png){:height 1079, :width 778}` is how Logseq embeds
 * an image; the size attribute after it is Logseq's alone. `[name](../assets/
 * foo.pdf)` links a file.
 */

export type AssetLink = {
  /** Where the link is in the text, size attribute included: `[start, end)`. */
  start: number;
  end: number;
  /** `![…](…)` rather than `[…](…)`. */
  embed: boolean;
  alt: string;
  /** The target as written. */
  target: string;
  /**
   * The file it names, relative to the graph folder (`assets/foo.png`), or
   * undefined for a target that would leave `assets/`.
   */
  asset: string | undefined;
};

const LINK = /(!?)\[([^\]\n]*)\]\(((?:\.\.\/)?assets\/[^)\s]+)\)(\{[^}\n]*\})?/g;

/** `assets/<name>` for a target, decoded, or undefined for one that would leave the folder. */
function assetOf(target: string): string | undefined {
  let path = target.replace(/^\.\.\//, "");
  try {
    path = decodeURI(path);
  } catch {
    // A broken escape is a name as written.
  }
  const parts = path.split("/");
  if (path.includes("\\") || parts.some((part) => part === ".." || part === "." || part === "")) return undefined;
  return path;
}

/** Every link into `assets/` in `text`, in order. */
export function assetLinks(text: string): AssetLink[] {
  return [...text.matchAll(LINK)].map((found) => {
    const [whole, bang, alt, target] = found;
    return {
      start: found.index,
      end: found.index + whole.length,
      embed: bang === "!",
      alt,
      target,
      asset: assetOf(target),
    };
  });
}

/**
 * `text` with each link in `swaps` written as the replacement given for it.
 * A link not in `swaps` stays as written, size attribute and all.
 */
export function relinked(text: string, swaps: ReadonlyMap<AssetLink, string>): string {
  let out = "";
  let at = 0;
  for (const [link, replacement] of [...swaps].sort(([a], [b]) => a.start - b.start)) {
    out += text.slice(at, link.start) + replacement;
    at = link.end;
  }
  return out + text.slice(at);
}
