import { useEffect, useState } from 'react';
import type { Availability, Project } from '../shared/projects';
import type { Page } from '../shared/pages';
import { AVAILABILITY_LABEL, formatLastOpened, today } from './ui';
import type { Act } from './ui';
import { Block, BlockEditor } from './Block';

const { projects: api, pages } = window.gnotes;

type Props = {
  project: Project;
  availability: Availability;
  act: Act;
};

export default function ProjectView({ project, availability, act }: Props) {
  // ponytail: read once per render, so a window left open across midnight
  // keeps yesterday's page until something re-renders it. Add a timer to the
  // next local midnight if that ever bites.
  const date = today();
  const [page, setPage] = useState<Page | null>(null);
  const [writing, setWriting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Where the click that opened the block landed. Undefined when there was no
  // click to read a position from — keyboard activation, or a new block.
  const [caret, setCaret] = useState<number | undefined>(undefined);
  const [renaming, setRenaming] = useState(false);

  /**
   * Today's page exists the moment it is asked for: main folds the log and
   * hands back whatever blocks carry this date, which for a fresh day is
   * none. Nothing is written until the user writes something.
   */
  useEffect(() => {
    let current = true;
    void pages.open(project.id, date).then((next) => {
      if (current) setPage(next);
    });
    // Dropped if the view moves to another project or the day rolls over
    // mid-session, so a slow read cannot paint the wrong page.
    return () => {
      current = false;
    };
  }, [project.id, date]);

  return (
    <>
      <h2 className="page-date">{date}</h2>

      {page === null ? (
        <p className="subtitle">Loading…</p>
      ) : (
        <div className="page">
          {page.blocks.map((block) =>
            editingId === block.id ? (
              <BlockEditor
                key={block.id}
                initial={block.text}
                caret={caret}
                onCancel={() => setEditingId(null)}
                /**
                 * Unchanged text is not an edit, and neither is emptying the
                 * box: deleting a block is a verb that does not exist yet, so
                 * committing the blank would leave one that cannot be removed.
                 * Both cases append nothing — the log takes facts, and it
                 * takes them forever.
                 */
                onCommit={(text) => {
                  setEditingId(null);
                  if (!text || text === block.text) return;
                  act(async () => {
                    setPage(
                      await pages.editBlock(
                        project.id,
                        date,
                        block.id,
                        text,
                      ),
                    );
                  });
                }}
              />
            ) : (
              <Block
                key={block.id}
                text={block.text}
                onActivate={(at) => {
                  setCaret(at);
                  setEditingId(block.id);
                }}
              />
            ),
          )}

          {writing ? (
            <BlockEditor
              placeholder="Write something…"
              onCancel={() => setWriting(false)}
              onCommit={(text) => {
                setWriting(false);
                if (!text) return;
                act(async () => {
                  setPage(await pages.addBlock(project.id, date, text));
                });
              }}
            />
          ) : (
            <button className="block empty" onClick={() => setWriting(true)}>
              {page.blocks.length === 0
                ? 'Click to write the first block'
                : 'Click to add a block'}
            </button>
          )}
        </div>
      )}
    </>
  );
}
