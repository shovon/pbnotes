/**
 * Whether a key press is the one that opens and closes the finder (#28):
 * Cmd+K on macOS, Ctrl+K elsewhere, with no other modifier. Only the
 * platform's own modifier, so Ctrl+K on a Mac stays kill-to-end-of-line in a
 * block being written.
 *
 * Pure, and told the platform rather than reading it, so it runs under
 * `node --test`; `ProjectView` listens for the key.
 */
export type Press = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

export function opensFinder(press: Press, mac: boolean): boolean {
  const modifier = mac ? press.metaKey && !press.ctrlKey : press.ctrlKey && !press.metaKey;
  return modifier && !press.altKey && !press.shiftKey && press.key.toLowerCase() === 'k';
}
