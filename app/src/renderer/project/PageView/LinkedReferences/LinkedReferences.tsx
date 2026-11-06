import type { Page } from '@pbnotes/graph';
import type { Act } from '../../../ui';
import PageView from '../PageView';
import type { PageViewGraph } from '../PageView';
import { under } from '../../selection/shown';

/**
 * What links to the page above, under it: each page that names this one,
 * cut down to the blocks that do, with their children for context. Each cut
 * is a `PageView` like the page above it — the same blocks, the same box
 * when one is clicked, the same writes — headed by the page it is cut from,
 * as a link there, which the project view follows like any other. Nothing
 * at all when nothing links here: a journal is mostly days nothing names,
 * and an empty heading under each would be noise.
 *
 * The heading counts every block that links here, loaded or not: a page
 * many blocks link to loads its cuts a chunk at a time as the window
 * scrolls (#285), and the count is what says there is more below.
 */
export default function LinkedReferences({
  graph,
  references,
  count,
  version,
  scope,
  act,
}: {
  /** Handed on whole to each cut, which is a `PageView`. */
  graph: PageViewGraph;
  references: Page[];
  /** How many blocks link here, in every cut, loaded or not. */
  count: number;
  /** The fold version the cuts were read at, handed on to each. */
  version: number;
  /** The view this is under: each cut is a view of its own within it (#253). */
  scope: string;
  act: Act;
}) {
  if (count === 0) return null;
  return (
    // Padding, not margin, for the air before the next day: a margin would
    // collapse into the next title's.
    <section className="pb-12">
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted">
        {count} linked reference{count === 1 ? '' : 's'}
      </h3>
      {references.map((page) => (
        <PageView
          key={page.title}
          graph={graph}
          page={page}
          version={version}
          scope={under(scope, page.title)}
          act={act}
          reference
        />
      ))}
    </section>
  );
}
