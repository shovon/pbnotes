/**
 * What an import reads from a graph's `logseq/config.edn`: how page
 * filenames are encoded, how journal files are named, and how journal pages
 * are titled. Three keys, so no EDN parser: each is matched where it is
 * written, outside comments.
 */

export type Config = {
  /** `:file/name-format`: `triple-lowbar`, or `legacy` when the key is absent. */
  fileNames: "triple-lowbar" | "legacy";
  /** `:journal/file-name-format`. */
  journalFiles: string;
  /** `:journal/page-title-format`. */
  journalTitles: string;
};

/** Logseq's defaults, which a graph with no config, or one that says nothing of a key, has. */
export const DEFAULTS: Config = {
  fileNames: "legacy",
  journalFiles: "yyyy_MM_dd",
  journalTitles: "MMM do, yyyy",
};

/** `text` with every `;` comment blanked, leaving strings alone. */
function uncommented(text: string): string {
  let out = "";
  let inString = false;
  for (let at = 0; at < text.length; at++) {
    const c = text[at];
    if (inString) {
      out += c;
      if (c === "\\") out += text[++at] ?? "";
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === ";") {
      while (at < text.length && text[at] !== "\n") at++;
      out += "\n";
    } else out += c;
  }
  return out;
}

/** The config `text` says, each key it does not say taken from `DEFAULTS`. */
export function readConfig(text: string): Config {
  const live = uncommented(text);
  const string = (key: string) => new RegExp(`${key}\\s+"((?:[^"\\\\]|\\\\.)*)"`).exec(live)?.[1];
  const names = /:file\/name-format\s+:([\w-]+)/.exec(live)?.[1];
  return {
    fileNames: names === "triple-lowbar" ? "triple-lowbar" : DEFAULTS.fileNames,
    journalFiles: string(":journal\\/file-name-format") ?? DEFAULTS.journalFiles,
    journalTitles: string(":journal\\/page-title-format") ?? DEFAULTS.journalTitles,
  };
}
