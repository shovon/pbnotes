/**
 * What the project picker's menu lists (#373), worked out without drawing
 * it: one row per project with the directory it lives in, a separator, then
 * Open project…. `projects-ipc.ts` turns these rows into a native menu.
 *
 * Free of `electron` and `node:` imports, so it runs under `node --test`.
 * Where the home directory is, and how the platform's menus look, are
 * handed in.
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
      /** The kind of item that marks the open project: `PickerLook.mark`. */
      mark: PickerLook["mark"];
    }
  | { kind: "separator" }
  | { kind: "add"; label: string };

/** How the menu looks on this platform: `pickerLook`. */
export type PickerLook = {
  /**
   * Where a project's directory goes: under its name as a sublabel, on the
   * label's own line after a dash, or nowhere.
   */
  directory: "sublabel" | "dash" | "none";
  /**
   * The kind of item that marks the open project. macOS draws a checked
   * radio item as a checkmark; Windows and Linux draw a radio bullet, so
   * there it is a checkbox, which they draw as a checkmark.
   */
  mark: "radio" | "checkbox";
};

export type PickerOptions = PickerLook & {
  /** The home directory, shown as `~`. */
  home: string;
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

/**
 * How the menu looks on `platform`. On macOS, the directory goes under the
 * name where a sublabel is drawn and after a dash where it isn't. Elsewhere
 * the native menu is wide already, and a Windows path makes it wider still,
 * so a row is the name alone.
 */
export function pickerLook(platform: string, version: string): PickerLook {
  if (platform !== "darwin") return { directory: "none", mark: "checkbox" };
  return {
    directory: drawsSublabels(platform, version) ? "sublabel" : "dash",
    mark: "radio",
  };
}

/** The menu's rows, in the order given, with `openId` checked. */
export function pickerRows(
  projects: readonly Pick<Project, "id" | "name" | "path">[],
  openId: string | null,
  { home, directory, mark }: PickerOptions,
): PickerRow[] {
  const rows: PickerRow[] = projects.map((project) => {
    const where = homeRelative(project.path, home);
    const row = { kind: "project", id: project.id, checked: project.id === openId, mark } as const;
    switch (directory) {
      case "sublabel":
        return { ...row, label: project.name, sublabel: where };
      case "dash":
        return { ...row, label: `${project.name} — ${where}` };
      case "none":
        return { ...row, label: project.name };
    }
  });
  return [...rows, { kind: "separator" }, { kind: "add", label: "Open project…" }];
}
