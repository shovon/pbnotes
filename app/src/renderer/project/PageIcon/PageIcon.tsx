import type { LucideIcon } from 'lucide-react';
import Icon from '../../Icon/Icon';
import { drawable } from './drawable/drawable';

type Props = {
  /** The page's icon as main sent it: any string, or none. */
  icon: string | null | undefined;
  /**
   * What to draw for a page with no icon, or one this build can't draw: a
   * Lucide icon, as the sidebar's Recent list wants (`file-text`, #331).
   * Left off, nothing is drawn, as in the header and the tab strip.
   */
  fallback?: LucideIcon;
  /** Its size and spacing where it is drawn. */
  className?: string;
};

/**
 * A page's icon (#323), where a page is named: the page's header, the tab
 * strip and the sidebar. Draws one emoji, and otherwise the fallback or
 * nothing (`drawable`), so an icon from a newer build never shows as raw
 * text. Decorative: the page's name beside it says what it is.
 */
export default function PageIcon({ icon, fallback, className = '' }: Props) {
  const shown = drawable(icon);
  if (!shown) return fallback ? <Icon of={fallback} /> : null;
  return (
    <span aria-hidden className={`shrink-0 leading-none ${className}`}>
      {shown}
    </span>
  );
}
