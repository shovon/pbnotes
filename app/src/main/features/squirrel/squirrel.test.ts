/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { shortcutSteps, squirrelEvent } from "./squirrel.ts";

const at = {
  exe: "C:\\Users\\me\\AppData\\Local\\pbnotes\\app-0.6.1\\pbnotes.exe",
  startMenu: "C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs",
  name: "Pb Notes",
  appUserModelId: "com.squirrel.pbnotes.pbnotes",
};
const root = "C:\\Users\\me\\AppData\\Local\\pbnotes";
const link = `${at.startMenu}\\Pb Notes.lnk`;

test("the event is Squirrel's first argument, and anything else is an ordinary start", () => {
  assert.equal(squirrelEvent(["pbnotes.exe", "--squirrel-install", "0.6.1"]), "install");
  assert.equal(squirrelEvent(["pbnotes.exe", "--squirrel-updated", "0.6.2"]), "updated");
  assert.equal(squirrelEvent(["pbnotes.exe", "--squirrel-uninstall", "0.6.2"]), "uninstall");
  assert.equal(squirrelEvent(["pbnotes.exe", "--squirrel-obsolete", "0.6.1"]), "obsolete");
  assert.equal(squirrelEvent(["pbnotes.exe", "--squirrel-firstrun"]), undefined);
  assert.equal(squirrelEvent(["pbnotes.exe"]), undefined);
  assert.equal(squirrelEvent(["electron", "."]), undefined);
});

for (const event of ["install", "updated"] as const) {
  test(`on ${event}: the app writes its Start menu shortcut at the top, then Squirrel makes the desktop one`, () => {
    assert.deepEqual(shortcutSteps(event, at), [
      {
        kind: "link",
        path: link,
        // The stub in the root, which starts the current version, not this one.
        target: `${root}\\pbnotes.exe`,
        icon: `${root}\\app.ico`,
        appUserModelId: "com.squirrel.pbnotes.pbnotes",
      },
      { kind: "update", exe: `${root}\\Update.exe`, args: ["--createShortcut=pbnotes.exe", "--shortcut-locations=Desktop"] },
    ]);
  });
}

test("on uninstall: the app's shortcut goes, then Squirrel's", () => {
  assert.deepEqual(shortcutSteps("uninstall", at), [
    { kind: "unlink", path: link },
    { kind: "update", exe: `${root}\\Update.exe`, args: ["--removeShortcut=pbnotes.exe", "--shortcut-locations=Desktop"] },
  ]);
});

test("each event asks Update.exe for one thing at most: the app cannot wait for it, so two would collide", () => {
  for (const event of ["install", "updated", "uninstall", "obsolete"] as const) {
    assert.ok(shortcutSteps(event, at).filter((s) => s.kind === "update").length <= 1, event);
  }
});

test("an obsolete version does nothing: a newer one is taking over", () => {
  assert.deepEqual(shortcutSteps("obsolete", at), []);
});
