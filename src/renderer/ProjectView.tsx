import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { Availability, Project } from '../shared/projects';
import type { Page } from '../shared/pages';
import { AVAILABILITY_LABEL, formatLastOpened, today } from './ui';
import type { Act } from './ui';

const { projects: api, pages } = window.gnotes;

type Props = {
  project: Project;
  availability: Availability;
  act: Act;
  onBack: () => void;
};

/**
 * The box while it is being written in. One implementation for both the new
 * block and an existing one, so the commit rules cannot drift apart: blur
 * commits, Escape unmounts the box before blur can fire and so discards —
 * which is how the rename field in the project list behaves too.
 */
function BlockEditor({
  initial,
  placeholder,
  onCommit,
  onCancel,
}: {
  initial?: string;
  placeholder?: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  return (
    <textarea
      className="block-input"
      autoFocus
      defaultValue={initial}
      placeholder={placeholder}
      onBlur={(event) => onCommit(event.target.value.trim())}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
    />
  );
}

export default function ProjectView({
  project,
  availability,
  act,
  onBack,
}: Props) {
  // ponytail: read once per render, so a window left open across midnight
  // keeps yesterday's page until something re-renders it. Add a timer to the
  // next local midnight if that ever bites.
  const date = today();
  const [page, setPage] = useState<Page | null>(null);
  const [writing, setWriting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

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
      <button className="back" onClick={onBack}>
        ‹ Projects
      </button>

      <header className="app-header">
        <div>
          <h1>{project.name}</h1>
          <div className="meta">
            <span className="path" title={project.path}>
              {project.path}
            </span>
            <span className="dot">·</span>
            <span>{formatLastOpened(project.lastOpenedAt)}</span>
            {availability !== 'available' && (
              <span className="badge">{AVAILABILITY_LABEL[availability]}</span>
            )}
          </div>
        </div>
        <div className="actions">
          <button onClick={() => act(() => api.reveal(project.id))}>
            Reveal
          </button>
          <button onClick={() => act(() => api.relocate(project.id))}>
            Locate…
          </button>
        </div>
      </header>

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
              /**
               * Not a <button>: Markdown emits block elements, and a button
               * may not contain them. A div with the button role keeps the
               * click-to-edit affordance reachable and announced.
               */
              <div
                key={block.id}
                className="block"
                role="button"
                tabIndex={0}
                onClick={() => setEditingId(block.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setEditingId(block.id);
                  }
                }}
              >
                <Markdown
                  remarkPlugins={[remarkMath]}
                  /**
                   * KaTeX throws on malformed TeX by default, which would
                   * take the whole page down over a half-typed formula. Bad
                   * math renders as flagged source instead; the note is
                   * still readable and still editable.
                   */
                  rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
                >
                  {block.text}
                </Markdown>
              </div>
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
