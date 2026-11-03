/**
 * Whether a key press is the one that shows and hides the sidebar (#184):
 * Cmd+\ on macOS, Ctrl+\ elsewhere, with no other modifier, as in Notion and
 * VS Code. Not Cmd/Ctrl+B, which is bold in most editors.
 *
 * Pure, and told the platform rather than reading it, so it runs under
 * `node --test`; `ProjectView` listens for the key.
 */
import type { Press } from "../../Finder/shortcut/shortcut.ts";

export function togglesSidebar(press: Press, mac: boolean): boolean {
  const modifier = mac ? press.metaKey && !press.ctrlKey : press.ctrlKey && !press.metaKey;
  return modifier && !press.altKey && !press.shiftKey && press.key === "\\";
}
