/**
 * What a page title's field asks for when it is committed (#109): the title
 * to rename to, or nothing. Pure, so the rule runs under `node --test`;
 * `Title.tsx` holds the field.
 */

/**
 * The title `draft` renames `title` to, trimmed, or undefined when it asks
 * for nothing: blank, or `title` itself once trimmed. A change of case is a
 * rename (#89); main decides what else it refuses.
 */
export function wanted(draft: string, title: string): string | undefined {
  const to = draft.trim();
  return to === '' || to === title ? undefined : to;
}
