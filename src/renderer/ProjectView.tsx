import { Fragment, useEffect, useState } from 'react';
import type { Availability, Project } from '../shared/projects';
import type { Block as BlockType, Page } from '../shared/pages';
import { AVAILABILITY_LABEL, formatLastOpened, today } from './ui';
import type { Act } from './ui';
import { Block, BlockEditor } from './Block';

const { projects: api, pages } = window.gnotes;

/**
 * Where an unwritten block is waiting to be typed. `after` is the block it
 * goes beneath; without one it goes at the end of the day. Null is no box
 * open at all — three states, because "writing" and "writing *here*" are
 * different questions and a boolean can only answer the first.
 */
type Writing = { after?: string } | null;

/**
 * The block `addBlock` just wrote, found by where it must have landed: the
 * fold splices it directly beneath `after`, or pushes it last. Saves widening
 * the IPC result to carry an id back for the one caller that wants it.
 */
function created(page: Page, after?: string): string | undefined {
  if (!after) return page.blocks.at(-1)?.id;
  const at = page.blocks.findIndex((block) => block.id === after);
  return page.blocks[at + 1]?.id;
}

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
  const [writing, setWriting] = useState<Writing>(null);
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

  /**
   * Text that came out of the box the way it went in is not an edit, and
   * appends nothing — the log takes facts, and it takes them forever.
   *
   * Emptying a block *is* an edit. A blank block is a legitimate thing to
   * want: a gap between two thoughts, or somewhere to come back to. It is
   * not a deleted block, and there is still no verb for that.
   */
  const commitEdit = (block: BlockType, text: string) => {
    setEditingId(null);
    if (text === block.text) return;
    act(async () => {
      setPage(await pages.editBlock(project.id, date, block.id, text));
    });
  };

  /**
   * Writes the box that is open, and optionally opens another beneath what it
   * just wrote — which is what makes a run of blocks typeable without
   * reaching for the mouse between them. The next box can only be placed once
   * the append has come back, because until then the block it goes under has
   * no id.
   */
  const commitNew = (text: string, { then }: { then: 'stop' | 'again' }) => {
    const after = writing?.after;
    setWriting(null);
    // An empty block is written when it is *asked* for — Enter on an empty
    // box is how a gap gets made. Blurring a box nothing was ever typed into
    // is a click that landed elsewhere, and writes nothing.
    if (!text && then === 'stop') return;
    act(async () => {
      const next = await pages.addBlock(project.id, date, text, after);
      setPage(next);
      if (then === 'again') setWriting({ after: created(next, after) });
    });
  };

  /** The box for a block that does not exist yet. */
  const newBlockEditor = (
    <BlockEditor
      placeholder="Write something…"
      onCancel={() => setWriting(null)}
      onCommit={(text) => commitNew(text, { then: 'stop' })}
      onContinue={(text) => commitNew(text, { then: 'again' })}
    />
  );

  return (
    <>
      <h2 className="page-date">{date}</h2>

      {page === null ? (
        <p className="subtitle">Loading…</p>
      ) : (
        <div className="page">
          {page.blocks.map((block) => (
            <Fragment key={block.id}>
              {editingId === block.id ? (
                <BlockEditor
                  initial={block.text}
                  caret={caret}
                  onCancel={() => setEditingId(null)}
                  onCommit={(text) => commitEdit(block, text)}
                  onContinue={(text) => {
                    commitEdit(block, text);
                    setWriting({ after: block.id });
                  }}
                />
              ) : (
                <Block
                  text={block.text}
                  onActivate={(at) => {
                    setCaret(at);
                    setEditingId(block.id);
                  }}
                />
              )}
              {writing?.after === block.id && newBlockEditor}
            </Fragment>
          ))}

          {/* The tail: a box when one is waiting at the end of the day, the
              invitation when nothing is open, and neither while the box sits
              between two blocks further up. */}
          {writing === null ? (
            <button className="block empty" onClick={() => setWriting({})}>
              {page.blocks.length === 0
                ? 'Click to write the first block'
                : 'Click to add a block'}
            </button>
          ) : writing.after === undefined ? (
            newBlockEditor
          ) : null}
        </div>
      )}
    </>
  );
}
