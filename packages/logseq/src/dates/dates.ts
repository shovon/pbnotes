/**
 * Calendar days written in a date-fns pattern, the kind Logseq's config
 * holds: `yyyy_MM_dd`, `MMM do, yyyy`, `EEE, dd.MM.yyyy`. Both ways: a day
 * in a pattern, and the day a string in a pattern names.
 *
 * Knows nothing of Logseq or pbnotes. A day is `YYYY-MM-DD`.
 *
 * Tokens read: `yyyy`, `yy`, `MMMM`, `MMM`, `MM`, `M`, `dd`, `d`, `do`,
 * `EEEE`, `EEE`, `EE`, `E`, and `'quoted text'`. Any other letter is taken
 * as itself.
 */

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Day = { year: number; month: number; date: number };

/** A pattern, cut into tokens and literal text. */
type Token = { token: string } | { literal: string };

function tokenize(pattern: string): Token[] {
  const out: Token[] = [];
  for (let at = 0; at < pattern.length; ) {
    const c = pattern[at];
    if (c === "'") {
      const end = pattern.indexOf("'", at + 1);
      const close = end === -1 ? pattern.length : end;
      // `''` is a quote mark.
      out.push({ literal: close === at + 1 ? "'" : pattern.slice(at + 1, close) });
      at = close + 1;
      continue;
    }
    if (!/[A-Za-z]/.test(c)) {
      out.push({ literal: c });
      at++;
      continue;
    }
    let end = at;
    while (pattern[end] === c) end++;
    let token = pattern.slice(at, end);
    if (token === "d" && pattern[end] === "o") {
      token = "do";
      end++;
    }
    out.push(KNOWN.has(token) ? { token } : { literal: token });
    at = end;
  }
  return out;
}

const KNOWN = new Set(["yyyy", "yy", "MMMM", "MMM", "MM", "M", "dd", "d", "do", "EEEE", "EEE", "EE", "E"]);

function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

const pad = (n: number, width: number) => String(n).padStart(width, "0");

function daysIn(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function dayOf(text: string): Day | undefined {
  const found = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!found) return undefined;
  const [year, month, date] = found.slice(1).map(Number);
  if (month < 1 || month > 12 || date < 1 || date > daysIn(year, month)) return undefined;
  return { year, month, date };
}

function render({ year, month, date }: Day, token: string): string {
  switch (token) {
    case "yyyy": return pad(year, 4);
    case "yy": return pad(year % 100, 2);
    case "MMMM": return LONG[month - 1];
    case "MMM": return SHORT[month - 1];
    case "MM": return pad(month, 2);
    case "M": return String(month);
    case "dd": return pad(date, 2);
    case "d": return String(date);
    case "do": return ordinal(date);
    default: {
      const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, date)).getUTCDay()];
      return token === "EEEE" ? weekday : weekday.slice(0, 3);
    }
  }
}

/** `day` (`YYYY-MM-DD`) written in `pattern`, or undefined for a day that is not a real one. */
export function format(pattern: string, day: string): string | undefined {
  const it = dayOf(day);
  if (!it) return undefined;
  return tokenize(pattern)
    .map((t) => ("literal" in t ? t.literal : render(it, t.token)))
    .join("");
}

const CAPTURE: Record<string, string> = {
  yyyy: "(\\d{4})",
  yy: "(\\d{2})",
  MMMM: "([a-z]+)",
  MMM: "([a-z]+)",
  MM: "(\\d{2})",
  M: "(\\d{1,2})",
  dd: "(\\d{2})",
  d: "(\\d{1,2})",
  do: "(\\d{1,2})[a-z]{2}",
  EEEE: "[a-z]+",
  EEE: "[a-z]+",
  EE: "[a-z]+",
  E: "[a-z]+",
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const MONTHS = new Map([...SHORT, ...LONG].map((name, at): [string, number] => [name.toLowerCase(), (at % 12) + 1]));

/**
 * The day (`YYYY-MM-DD`) that `text` names in `pattern`, or undefined. Case
 * does not matter. A string that names no real day, or whose weekday or
 * ordinal is wrong for its day, names none: the day found is written back in
 * the pattern and must come out as `text`.
 */
export function parse(pattern: string, text: string): string | undefined {
  const tokens = tokenize(pattern);
  const fields: string[] = [];
  let source = "^";
  for (const t of tokens) {
    if ("literal" in t) source += escape(t.literal);
    else {
      source += CAPTURE[t.token];
      if (CAPTURE[t.token].includes("(")) fields.push(t.token);
    }
  }
  const found = new RegExp(`${source}$`, "i").exec(text);
  if (!found) return undefined;
  let year: number | undefined;
  let month: number | undefined;
  let date: number | undefined;
  fields.forEach((token, at) => {
    const value = found[at + 1];
    if (token === "yyyy") year = Number(value);
    else if (token === "yy") year = 2000 + Number(value);
    else if (token.startsWith("M")) month = /^\d/.test(value) ? Number(value) : MONTHS.get(value.toLowerCase());
    else date = Number(value);
  });
  if (year === undefined || month === undefined || date === undefined) return undefined;
  const day = `${pad(year, 4)}-${pad(month, 2)}-${pad(date, 2)}`;
  const back = format(pattern, day);
  return back !== undefined && back.toLowerCase() === text.toLowerCase() ? day : undefined;
}
