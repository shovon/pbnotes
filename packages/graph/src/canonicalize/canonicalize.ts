/**
 * The canonical form of a page title: two titles are one page when this
 * gives the same string for both (#83). `[[Mira]]`, `[[mira]]` and `#MIRA`
 * all open the same one.
 *
 * The expression itself is the contract, not just its intent: every reader
 * of a folder has to compute exactly this, byte for byte, or it groups pages
 * differently from the app. The README states it under "Page titles are a
 * contract", and `canonicalize.test.ts` pins it.
 *
 * Not `toLocaleLowerCase()`, which depends on the machine's locale: two
 * devices would fold one ledger into different pages.
 *
 * Unicode forms fold too (#88): `Café` typed as one `é` and as `e` plus a
 * combining accent is one page (NFC, which, unlike NFKC, leaves `ﬁ` and `x²`
 * alone). A zero-width space or byte-order mark pasted in is dropped; the
 * zero-width joiner and non-joiner stay, since emoji and Persian need them.
 * NFC goes last because lowercasing can undo it.
 *
 * Computed on every read and never written down, so the log keeps every title
 * as it was typed. Changing this regroups pages in every existing ledger on
 * the next open — merging or splitting them — so it changes rarely and on
 * purpose.
 */
export function canonicalize(title: string): string {
  return title.replace(/[\u200B\uFEFF]/g, "").trim().toLowerCase().normalize("NFC");
}
