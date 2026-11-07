/**
 * A page's title from its filename, decoded the way Logseq encoded it, and
 * a journal file's day from its name. Names in, strings out.
 */
import { parse } from "../dates/dates.ts";

/** `%XX` escapes decoded where they make UTF-8, anything else left as written. */
function percentDecoded(name: string): string {
  return name.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

/**
 * The title a page file's name (without `.md`) stands for, under Logseq's
 * `:file/name-format`:
 *
 * - `triple-lowbar`: `___` is `/`, and percent escapes are decoded.
 * - `legacy`: `.` is `/`, and percent escapes are decoded (so `%2E` stays a dot).
 */
export function titleOfFile(name: string, format: "triple-lowbar" | "legacy"): string {
  const slashed = format === "triple-lowbar" ? name.replaceAll("___", "/") : name.replaceAll(".", "/");
  return percentDecoded(slashed).normalize("NFC");
}

/** The `YYYY-MM-DD` a journal file's name (without `.md`) names in `pattern`, or undefined. */
export function dayOfFile(name: string, pattern: string): string | undefined {
  return parse(pattern, name);
}
