/**
 * The page names a Logseq list property names: the value of `tags::` or
 * `alias::`.
 *
 * `[[A]]`, `#[[A]]`, `#A` and a bare `A` each name `A`. Items are separated
 * by commas, or by spaces between `#` and `[[…]]` items; a bare item runs to
 * the next comma. So `#[[Self Development]] #[[Social Skills]]` names two
 * pages, and so does `Self Development, Social Skills`.
 */

export type Named = {
  names: string[];
  /** Items that read as nothing: `[[]]`, a lone `#`, or nothing between two commas. */
  blanks: number;
};

/** The index just past the `]]` that closes the `[[` at `at`, nested pairs and all, or -1. */
function closing(value: string, at: number): number {
  let depth = 0;
  for (let i = at; i < value.length - 1; i++) {
    if (value.startsWith("[[", i)) {
      depth++;
      i++;
    } else if (value.startsWith("]]", i)) {
      depth--;
      i++;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

export function namesIn(value: string): Named {
  const names: string[] = [];
  let blanks = 0;
  const take = (name: string) => {
    const it = name.trim();
    if (it === "") blanks++;
    else names.push(it);
  };
  let at = 0;
  // Whether a comma has been seen since the last item: two in a row hold a blank.
  let afterComma = false;
  while (at < value.length) {
    const c = value[at];
    if (c === " " || c === "\t") {
      at++;
      continue;
    }
    if (c === ",") {
      if (afterComma) blanks++;
      afterComma = true;
      at++;
      continue;
    }
    afterComma = false;
    const link = value.startsWith("#[[", at) ? at + 1 : value.startsWith("[[", at) ? at : -1;
    const closed = link === -1 ? -1 : closing(value, link);
    if (closed !== -1) {
      take(value.slice(link + 2, closed - 2));
      at = closed;
      continue;
    }
    if (c === "#") {
      const stop = value.slice(at + 1).search(/[\s,]/);
      const word = stop === -1 ? value.length : at + 1 + stop;
      take(value.slice(at + 1, word));
      at = word;
      continue;
    }
    const stop = value.indexOf(",", at);
    const end = stop === -1 ? value.length : stop;
    take(value.slice(at, end));
    at = end;
  }
  return { names, blanks };
}
