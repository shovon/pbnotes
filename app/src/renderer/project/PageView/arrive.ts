/**
 * Points at something that just opened somewhere other than where it was
 * asked for: the first tag's input or the first property's row, which open
 * under the title though their buttons sit above it. Scrolls only as far as
 * it takes to show it, then fades an accent tint out of it.
 */
export function arrive(element: Element | null | undefined) {
  if (!element) return;
  element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  element.animate(
    [{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 18%, transparent)' }, {}],
    { duration: 700, easing: 'ease-out' },
  );
}
