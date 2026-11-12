/**
 * What the project picker's menu lists (#373), worked out without drawing
 * it: one row per project with the directory it lives in, a separator, then
 * Open project…. `projects-ipc.ts` turns these rows into a native menu.
 *
 * Free of `electron` and `node:` imports, so it runs under `node --test`.
 * Where the home directory is, and whether the platform draws a sublabel,
 * are handed in.
 */
import type { Project } from "../../../../shared/projects.ts";

export type PickerRow =
  | {
      kind: "project";
      id: string;
      label: string;
      /** Drawn under the label in lighter text. Absent where it can't be. */
      sublabel?: string;
      checked: boolean;
    }
  | { kind: "separator" }
  | { kind: "add"; label: string };

export type PickerOptions = {
  /** The home directory, shown as `~`. */
  home: string;
  /**
   * Whether the menu draws a sublabel. Where it doesn't, the directory goes
   * on the label's own line after a dash, rather than being dropped.
   */
  sublabels: boolean;
};

/**
 * `path` with a leading `home` shown as `~`, and left as it is when it is
 * not under `home`. Only a whole directory counts: with home at
 * `/Users/sal`, `/Users/sally` is not under it.
 */
export function homeRelative(path: string, home: string): string {
  const trimmed = home.replace(/[/\\]+$/, "");
  if (trimmed === "") return path;
  if (path === trimmed) return "~";
  const next = path.charAt(trimmed.length);
  if (path.startsWith(trimmed) && (next === "/" || next === "\\")) {
    return `~${path.slice(trimmed.length)}`;
  }
  return path;
}

/**
 * Whether the platform draws `MenuItem.sublabel`: macOS 14.4 and later
 * only. Electron ignores it everywhere else without saying so, so this is
 * asked rather than assumed. `version` is `process.getSystemVersion()`, as
 * in `"14.4.1"`; one that doesn't read as a version counts as too old.
 */
export function drawsSublabels(platform: string, version: string): boolean {
  if (platform !== "darwin") return false;
  const match = /^(\d+)(?:\.(\d+))?/.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2] ?? 0);
  return major > 14 || (major === 14 && minor >= 4);
}

/** The menu's rows, in the order given, with `openId` checked. */
export function pickerRows(
  projects: readonly Pick<Project, "id" | "name" | "path">[],
  openId: string | null,
  { home, sublabels }: PickerOptions,
): PickerRow[] {
  const rows: PickerRow[] = projects.map((project) => {
    const where = homeRelative(project.path, home);
    const checked = project.id === openId;
    return sublabels
      ? { kind: "project", id: project.id, label: project.name, sublabel: where, checked }
      : { kind: "project", id: project.id, label: `${project.name} — ${where}`, checked };
  });
  return [...rows, { kind: "separator" }, { kind: "add", label: "Open project…" }];
}
