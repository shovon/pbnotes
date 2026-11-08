/**
 * Whether a page's icon can be drawn (#323). The graph keeps any string as an
 * icon (#322): this build draws one emoji, and shows no icon for anything
 * else, such as an `image:` icon from a newer build or text typed by hand.
 *
 * Pure, so it runs under `node --test`.
 */

/** One emoji: a pictograph (with whatever joins or modifies it), a flag, or a keycap. */
const EMOJI = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[#*0-9]️?⃣)/u;

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** `icon` when it is exactly one emoji, else undefined. */
export function drawable(icon: string | null | undefined): string | undefined {
  if (!icon) return undefined;
  const [first, second] = graphemes.segment(icon);
  if (!first || second) return undefined;
  return EMOJI.test(first.segment) ? icon : undefined;
}
