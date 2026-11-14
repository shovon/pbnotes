import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { Availability, Project } from '../../shared/projects';
import Icon from '../Icon/Icon';

type Props = {
  projects: Project[];
  /** The project open behind the modal, if any. */
  openId: string | null;
  /** Each project's directory, home as `~`, keyed by id: `projects.directories`. */
  directories: Record<string, string>;
  /** What is known of each project's folder, keyed by id: `projects.availability`. */
  availability: Record<string, Availability>;
  /** Why each project that failed to open this session didn't, keyed by id. */
  failures: Record<string, string>;
  /** Something to say above the list: what the app's notice says while the modal hides it. */
  notice?: string | null;
  onOpen: (id: string) => void;
  /** Open project…: asks for a directory, as the picker's item does. */
  onAdd: () => void;
  /**
   * Closes the modal. Absent with no project open: there is nothing behind it
   * to go back to, so it can't be dismissed, and it goes once a project opens.
   */
  onClose?: () => void;
};

/** What a row says of its project, if anything is known: never a guess. */
function statusOf(
  id: string,
  { openId, availability, failures }: Pick<Props, 'openId' | 'availability' | 'failures'>,
): { label: string; reason?: string } | null {
  if (id === openId) return { label: 'Open' };
  // `unknown` is not missing: a sleeping share and a slow drive look the
  // same as a deleted folder from here (`Availability`).
  if (availability[id] === 'missing') return { label: 'Missing' };
  const reason = failures[id];
  if (reason !== undefined) return { label: "Can't open", reason };
  return null;
}

/**
 * Every tracked project, the directory it is in, and whatever is known about
 * whether it can be opened (#393). A modal that blocks the whole window,
 * title bar and picker included. With a project open behind it, Escape, a
 * click on the backdrop or the × closes it; with none, nothing does, and it
 * stays until a project opens.
 *
 * Clicking a row opens its project, unless its folder is missing. Clicking
 * the open one closes the modal.
 */
export default function ManageProjects({
  projects,
  openId,
  directories,
  availability,
  failures,
  notice,
  onOpen,
  onAdd,
  onClose,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  // Read by the `close` handler, which is bound once; kept current here.
  const close = useRef(onClose);
  close.current = onClose;
  /**
   * Set when the effect closes the box itself, on unmount. `close` is
   * dispatched a task later, so under StrictMode's second mount it reaches
   * the listener added after it, which must not take it for the user's.
   */
  const ours = useRef(false);

  useEffect(() => {
    const box = dialog.current;
    if (!box) return;
    if (!box.open) box.showModal();
    // Chromium lets a second Escape close a modal whose `cancel` was
    // prevented, unless the page was clicked in between, so preventing it is
    // not enough to keep the modal up. Closed while it can't be dismissed, it
    // opens again; closed while it can, it is dismissed.
    const closed = () => {
      if (ours.current) {
        ours.current = false;
        return;
      }
      if (close.current) close.current();
      else if (!box.open) box.showModal();
    };
    box.addEventListener('close', closed);
    return () => {
      box.removeEventListener('close', closed);
      if (box.open) {
        ours.current = true;
        box.close();
      }
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="manage-projects-title"
      className="mx-auto mt-[14vh] w-[min(34rem,calc(100vw-2rem))] rounded-md border border-line bg-bg p-4 text-fg shadow-xl backdrop:bg-fg/20"
      onCancel={(event) => {
        event.preventDefault();
        onClose?.();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 id="manage-projects-title" className="text-base font-semibold">
          Manage projects
        </h2>
        {onClose && (
          <button
            type="button"
            aria-label="Close"
            className="cursor-pointer rounded-md p-1 text-muted hover:text-fg"
            onClick={onClose}
          >
            <Icon of={X} />
          </button>
        )}
      </div>
      {!openId && <p className="mb-3 text-sm text-muted">No project is open. Pick one to open it.</p>}
      {notice && <p className="mb-3 rounded-md bg-warn-bg px-3 py-2 text-sm text-warn-fg">{notice}</p>}

      <ul className="-mx-2 max-h-[50vh] overflow-y-auto">
        {projects.map((project) => {
          const status = statusOf(project.id, { openId, availability, failures });
          const missing = status?.label === 'Missing';
          const where = directories[project.id];
          return (
            <li key={project.id}>
              <button
                type="button"
                disabled={missing}
                title={status?.reason}
                className="flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-left enabled:hover:bg-bar disabled:cursor-default"
                onClick={() => (project.id === openId ? onClose?.() : onOpen(project.id))}
              >
                <span className="min-w-0 flex-1">
                  <span className={`block truncate font-semibold ${missing ? 'text-muted' : ''}`}>
                    {project.name}
                  </span>
                  {where !== undefined && <span className="block truncate text-xs text-muted">{where}</span>}
                  {status?.reason && <span className="block truncate text-xs text-warn-fg">{status.reason}</span>}
                </span>
                {status && (
                  <span
                    className={`shrink-0 rounded-sm px-1.5 py-0.5 text-xs ${
                      status.label === 'Open' ? 'text-muted' : 'bg-warn-bg text-warn-fg'
                    }`}
                  >
                    {status.label}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          className="cursor-pointer rounded-md bg-accent px-3.5 py-1.5 text-sm text-on-accent hover:brightness-110"
          onClick={onAdd}
        >
          Open project…
        </button>
      </div>
    </dialog>
  );
}
