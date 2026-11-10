/**
 * What the Windows installer (Squirrel) asks of the app, and what the app does
 * about its shortcuts (#348). Squirrel starts the app with one of these as its
 * first argument, waits for it to exit, and expects nothing else of it.
 *
 * Squirrel can make the shortcuts itself (`Update.exe --createShortcut`), but
 * it puts the Start menu one in a folder named after the publisher, so the
 * Start menu lists "Sal Rahman", not "Pb Notes", and it cannot be told not to.
 * So Squirrel makes only the desktop one, and the app writes the Start menu
 * one itself, at the top of the list.
 *
 * The app cannot wait for `Update.exe`: the installer's own is running, holds
 * the app's lock until the app exits, and gives the app 15 seconds before it
 * cancels it. So each event asks `Update.exe` for one thing at most, started
 * on its own to run once the installer lets go, and the app's own steps come
 * first.
 *
 * Pure: the arguments and the places in, the steps out, so it runs under
 * `node --test`. `index.ts` runs the steps in order, and quits.
 */
import path from "node:path";

export type SquirrelEvent = "install" | "updated" | "uninstall" | "obsolete";

const EVENTS: Record<string, SquirrelEvent> = {
  "--squirrel-install": "install",
  "--squirrel-updated": "updated",
  "--squirrel-uninstall": "uninstall",
  "--squirrel-obsolete": "obsolete",
};

/**
 * The event Squirrel started the app for, from `process.argv`, or undefined
 * for an ordinary start. `--squirrel-firstrun`, after an install, is an
 * ordinary start: the app opens.
 */
export function squirrelEvent(argv: readonly string[]): SquirrelEvent | undefined {
  return EVENTS[argv[1] ?? ""];
}

/** Where things are, as `index.ts` finds them. */
export type Places = {
  /** The installed app's own executable, `process.execPath`: `<root>\app-<version>\pbnotes.exe`. */
  exe: string;
  /** The user's Start menu programs folder. */
  startMenu: string;
  /** What the Start menu shortcut is called, without `.lnk`: the product name. */
  name: string;
  /** The ID Windows groups the app's windows and pins under, as Squirrel's own shortcuts set it. */
  appUserModelId: string;
};

export type Step =
  /** Start Squirrel's `Update.exe` with these arguments, on its own: never waited for. */
  | { kind: "update"; exe: string; args: string[] }
  /** Write a shortcut, replacing one already there. */
  | { kind: "link"; path: string; target: string; icon: string; appUserModelId: string }
  /** Delete a file, if it is there. */
  | { kind: "unlink"; path: string };

/** What to do for `event`, in order. Nothing for an obsolete version: a newer one is taking over. */
export function shortcutSteps(event: SquirrelEvent, at: Places): Step[] {
  // Windows paths whatever runs this, so the tests read the same everywhere.
  const win = path.win32;
  const exeName = win.basename(at.exe);
  // The root holds Squirrel's `Update.exe`, its `app.ico`, and a stub
  // `pbnotes.exe` that starts whichever version is current, so a shortcut to
  // it outlives every update.
  const root = win.dirname(win.dirname(at.exe));
  const update = (...args: string[]): Step => ({ kind: "update", exe: win.join(root, "Update.exe"), args });
  const startMenuLink = win.join(at.startMenu, `${at.name}.lnk`);

  switch (event) {
    case "install":
    case "updated":
      return [
        {
          kind: "link",
          path: startMenuLink,
          target: win.join(root, exeName),
          icon: win.join(root, "app.ico"),
          appUserModelId: at.appUserModelId,
        },
        update(`--createShortcut=${exeName}`, "--shortcut-locations=Desktop"),
      ];
    case "uninstall":
      return [
        { kind: "unlink", path: startMenuLink },
        update(`--removeShortcut=${exeName}`, "--shortcut-locations=Desktop"),
      ];
    case "obsolete":
      return [];
  }
}
