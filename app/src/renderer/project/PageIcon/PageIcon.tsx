import { drawable } from './drawable/drawable';

type Props = {
  /** The page's icon as main sent it: any string, or none. */
  icon: string | null | undefined;
  /** Its size and spacing where it is drawn. */
  className?: string;
};

/**
 * A page's icon (#323), where a page is named: the tab strip, and the page's
 * header. Draws one emoji, and nothing at all for a value it can't draw
 * (`drawable`), so an icon from a newer build never shows as raw text.
 * Decorative: the page's name beside it says what it is.
 */
export default function PageIcon({ icon, className = '' }: Props) {
  const shown = drawable(icon);
  if (!shown) return null;
  return (
    <span aria-hidden className={`shrink-0 leading-none ${className}`}>
      {shown}
    </span>
  );
}
