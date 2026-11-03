import { useState } from 'react';
import { collapse } from './collapse/collapse';

type Props = {
  /** The page tagged, as its title shows. */
  tag: string;
  /** The pages that tag it, as `getTaggedBy` lists them. */
  pages: string[];
};

/**
 * The pages that tag the page above, as links, one per line. A tag is on a
 * whole page, so these are pages, not blocks. Nothing at all when nothing
 * tags the page, as with linked references.
 *
 * A long list shows its first ones and a way to show the rest. Expanded is
 * this view's own state: it is not kept, so the next visit starts collapsed.
 */
export default function TaggedBy({ tag, pages }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (pages.length === 0) return null;
  const { shown, hidden } = collapse(pages, expanded);
  return (
    <section aria-label="Tagged by">
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted">
        {pages.length} page{pages.length === 1 ? '' : 's'} tagged {tag}
      </h3>
      <ul className="flex flex-col gap-1 text-sm">
        {shown.map((page) => (
          <li key={page}>
            {/* The project view follows it like any wikilink. */}
            <a className="wikilink break-words text-accent hover:underline" href={`#${page}`}>
              {page}
            </a>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          className="mt-1 text-sm text-muted hover:text-fg focus-visible:text-fg"
          onClick={() => setExpanded(true)}
        >
          Show all {pages.length}
        </button>
      )}
    </section>
  );
}
