import type { Page } from '../../../../shared/pages';
import type { Project } from '../../../../shared/projects';
import type { Act } from '../../../ui';
import PageView from '../PageView';

/**
 * What links to the page above, under it: each page that names this one,
 * cut down to the blocks that do, with their children for context. Each cut
 * is a `PageView` like the page above it — the same blocks, the same box
 * when one is clicked, the same writes — headed by the page it is cut from,
 * as a link there, which the project view follows like any other. Nothing
 * at all when nothing links here: a journal is mostly days nothing names,
 * and an empty heading under each would be noise.
 */
export default function LinkedReferences({
  project,
  references,
  act,
  onPage,
}: {
  project: Project;
  references: Page[];
  act: Act;
  /** A write in a cut hands back the whole page it was cut from. */
  onPage: (page: Page) => void;
}) {
  if (references.length === 0) return null;
  const count = references.reduce((n, page) => n + page.blocks.length, 0);
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
          project={project}
          page={page}
          onPage={onPage}
          act={act}
          reference
        />
      ))}
    </section>
  );
}
