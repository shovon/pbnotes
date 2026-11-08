import { useCallback, useEffect, useState } from 'react';
import type { BenchApi } from '../../shared/bench';
import type { TabItem } from '../../shared/window';
import type { Project, ProjectsApi } from '../../shared/projects';
import { sidebarKept } from '../kept/kept';
import ProjectPicker from '../ProjectPicker/ProjectPicker';
import ProjectView from '../project/ProjectView';
import type { ProjectViewGraph } from '../project/ProjectView';
import Welcome from '../Welcome/Welcome';
import type { Act } from '../ui';
import { humanize } from '../humanize/humanize';

/**
 * Handed in by the composition root (`index.tsx`), never read off `window`.
 * Only the project calls this view makes; `graph` is passed on to the
 * project that is open.
 */
type Props = {
  projects: Pick<ProjectsApi, 'list' | 'current' | 'open' | 'pick'>;
  /** Only what the project that is open calls. */
  graph: ProjectViewGraph;
  /**
   * Where the open project's sidebar is kept. Never handed down as it is:
   * each mounted project gets its own `Kept` values over it (`kept/`).
   */
  bench: Pick<BenchApi, 'get' | 'set'>;
  /** Closes this window, passed on to the project that is open: its last tab closing (#303). */
  closeWindow: () => Promise<void>;
  /**
   * Hears the menu's tab items (#304), passed on to the project that is
   * open. With none, there are no tabs: Close Tab closes the window.
   */
  onTab: (listener: (item: TabItem) => void) => () => void;
  /** The clock, passed on to the project that is open. */
  now: () => Date;
  /** A number in [0, 1), as `Math.random` gives one, passed on to the project that is open. */
  random: () => number;
  /** Whether this is macOS, passed on to the project that is open. */
  mac: boolean;
};

export default function App({
  projects: api,
  graph,
  bench,
  closeWindow,
  onTab,
  now,
  random,
  mac,
}: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * Which project is open is main's to say, and this is its answer as last
   * read. There is no address bar and nobody reloads the window, so there is
   * no URL for a router to own; when there is an external `pbnotes://` link
   * to honour, main is where it lands.
   */
  const [project, setProject] = useState<Project | null>(null);

  /**
   * With no project open there are no tabs (#304): Close Tab closes the
   * window, as Close Window does, and the other tab items do nothing. With
   * one open, its view hears them instead.
   */
  useEffect(() => {
    if (project) return;
    const off = onTab((item) => {
      if (item === 'close') void closeWindow();
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, [project, onTab, closeWindow]);

  /**
   * The view renders from the database alone: nothing here waits on the disk,
   * so a sleeping network share cannot hold up the first paint. `loading`
   * clears on both paths — a failed list must not leave the app showing
   * "Loading…" with no way out.
   *
   * Whether each project can be reached (`projects.availability`) is not read
   * here: nothing on screen shows it yet. It comes back with the code that
   * draws it.
   */
  const refresh = useCallback(async (): Promise<Project[]> => {
    try {
      // Together, so a rename shows through in the picker and the page at
      // once, and a project removed from under the view takes it along.
      const [next, current] = await Promise.all([api.list(), api.current()]);
      setProjects(next);
      setProject(current);
      setLoading(false);
      return next;
    } catch (error) {
      setNotice(humanize(error));
      setLoading(false);
      return [];
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Every button in every view reaches main, and every one of those calls can
   * reject — relocating onto an already-tracked directory does exactly that.
   * Unhandled, the rejection is silent and the click looks like a no-op.
   */
  const run = useCallback(async (action: () => Promise<void>) => {
    setNotice(null);
    try {
      await action();
    } catch (error) {
      setNotice(humanize(error));
    }
  }, []);

  /**
   * Anything that changes a project re-reads the list rather than patching the
   * row in place: a rename has to show through in the picker, and a removal
   * has to take the open project with it.
   */
  const act = useCallback<Act>(
    (action) =>
      void run(async () => {
        await action();
        await refresh();
      }),
    [run, refresh],
  );

  /**
   * What the mounted project keeps, made for it alone and turned off when it
   * goes. A save from a view that is unmounting, or a load that answers after
   * the project changed, then reaches nothing, rather than the project now
   * open: the bench keeps each value for whichever project is open when a
   * call lands. Made in an effect, not during render, so StrictMode's second
   * mount gets a pair that is on.
   */
  const projectId = project?.id;
  const [kept, setKept] = useState<
    (ReturnType<typeof sidebarKept> & { projectId: string }) | null
  >(null);
  useEffect(() => {
    if (projectId === undefined) return;
    const next = { ...sidebarKept(bench, (error) => console.error(error)), projectId };
    setKept(next);
    return () => next.off();
  }, [projectId]);

  const openProject = useCallback(
    (id: string) => act(() => api.open(id)),
    [act],
  );

  /**
   * Adding opens what was added: the only reason to pick a directory is to
   * write in it, and making that a second click would be a page in disguise.
   */
  const addProjects = useCallback(
    (): void =>
      void run(async () => {
        const result = await api.pick();
        if (result.canceled) return;

        const added = result.outcomes.filter((o) => o.status === 'added');
        const duplicates = result.outcomes.filter(
          (outcome) => outcome.status === 'already-tracked',
        );
        const failures = result.outcomes.filter(
          (outcome) => outcome.status === 'failed',
        ).length;

        const parts: string[] = [];
        if (duplicates.length > 0) parts.push(`${duplicates.length} already tracked`);
        if (failures > 0) parts.push(`${failures} could not be read`);

        await refresh();
        setNotice(parts.length > 0 ? parts.join(' · ') : null);

        // An already-tracked directory is still the one the user just asked
        // for, so it opens too rather than leaving them where they were.
        const target = added.at(-1)?.project ?? duplicates.at(-1)?.project;
        if (target) openProject(target.id);
      }),
    [run, refresh, openProject],
  );

  return (
    <>
      {/* The window's own top strip, where the title bar used to be. The
          picker is the one control that is not about the project currently
          open, so it belongs above the page rather than on it — beside
          whichever corner the platform puts its window buttons in.

          The window buttons are laid over this same strip, and which corner
          they take is the platform's business: macOS puts them left, Windows
          and Linux right. `env(titlebar-area-*)` is the box they leave free,
          which is the whole point of `titleBarOverlay` — the fallbacks are
          macOS's own inset, for the moment before Chromium has measured the
          frame.

          That box is measured against the window, not the page, and docked
          DevTools makes the page the narrower of the two — so the strip is
          capped to the page, or it lies over the inspector's own toolbar and
          takes its clicks as drags.

          The strip's fill and rule are on a backing of their own rather than
          on the header, because the header stops short of the window buttons
          and the fill must not. The backing is sized to the page, not the
          window, so docked DevTools caps it too. Its rule hangs just below
          the measured strip rather than inside it, where the Windows and
          Linux controls, which are opaque, would paint over its right end.
          It is a handle as well: the gap beside the buttons drags too.

          The header is a layer above the backing, because the sidebar's
          column reaches up through the strip, over the backing and under
          the toggle and picker. */}
      <div
        aria-hidden
        className="app-region-drag fixed inset-x-0 top-0 z-20 box-content h-[calc(env(titlebar-area-y,0px)+env(titlebar-area-height,var(--spacing-titlebar)))] border-b border-line bg-bar"
      />
      <header
        id="titlebar"
        className="app-region-drag fixed z-30 top-[env(titlebar-area-y,0px)] left-[env(titlebar-area-x,5rem)] flex h-[env(titlebar-area-height,var(--spacing-titlebar))] w-[env(titlebar-area-width,calc(100%-5rem))] max-w-[calc(100%-env(titlebar-area-x,5rem))] items-center"
      >
        {/* Where the open project puts its sidebar toggle: first, before the
            picker. A portal adds to the end of what it is handed, so the
            project is handed this rather than the header. */}
        {/* The toggle and picker take the sidebar's width, sidebar showing
            or not, whatever the project is called: the picker is the same
            width for every project rather than jumping with its name, and
            what the page adds after them (the way back) starts past the
            sidebar's edge and stays put. A long project name is cut short
            rather than pushed into the tabs (#303), and the picker shows it
            whole when pointed at. */}
        <div className="flex w-[calc(var(--spacing-sidebar)-env(titlebar-area-x,5rem))] min-w-0 shrink-0 items-center">
          <div id="titlebar-start" className="contents" />
          {project && (
            <ProjectPicker
              projects={projects}
              projectId={project.id}
              onSelect={openProject}
              onAdd={addProjects}
            />
          )}
        </div>
      </header>

      {/* While the sidebar is in the DOM (it is left out when collapsed),
          the page is centred in the room beside it rather than in the
          window, and narrows when there is less than its width. The same
          for the right sidebar (#287), which is there only while it holds a
          page, and sets its own width. */}
      <div className="has-[[data-sidebar]]:pl-sidebar has-[[data-aside]]:pr-(--aside-width)">
        <main className="mx-auto box-content max-w-page px-6 pt-[calc(var(--spacing-titlebar)+--spacing(3))] pb-12">
          {notice && (
            <p
              className="mb-4 cursor-pointer rounded-md bg-warn-bg px-3 py-2 text-sm text-warn-fg"
              onClick={() => setNotice(null)}>
              {notice}
            </p>
          )}

          {project ? (
            kept?.projectId === project.id && (
              <ProjectView
                // Remounted per project, so nothing survives the switch: the
                // state, the open editor and the block id it is editing all
                // belong to the project that was showing a moment ago. The key is
                // all the view is told about which project that is.
                key={project.id}
                act={act}
                graph={graph}
                now={now}
                random={random}
                mac={mac}
                closeWindow={closeWindow}
                onTab={onTab}
                recentPages={kept.recentPages}
                sidebar={kept.sidebar}
                recentSection={kept.recentSection}
                recentEmoji={kept.recentEmoji}
              />
            )
          ) : (
            !loading && <Welcome onAdd={addProjects} />
          )}
        </main>
      </div>
    </>
  );
}
