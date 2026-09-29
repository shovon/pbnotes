/**
 * The projects contract: the types and channel names that main, preload and
 * renderer all have to agree on. Everything under `src/shared` is bundled into
 * the renderer as well as the main process, so it must stay free of `node:`
 * imports and of anything that is not a type or a constant.
 */

/** A project directory the user has explicitly chosen to track. */
export type Project = {
  /**
   * Stable identity. Deliberately not the path: users move and rename
   * directories, and anything keyed on the path would orphan itself when they
   * do. The path is mutable metadata; this is not.
   */
  id: string;
  path: string;
  /** User-editable label. Defaults to the directory's basename. */
  name: string;
  addedAt: string;
  lastOpenedAt: string | null;
  pinned: boolean;
};

/**
 * Whether a tracked directory is currently reachable. `unknown` is its own
 * state on purpose: an unmounted drive, a sleeping network share and a
 * not-yet-materialised cloud folder are indistinguishable from a deleted one
 * at the syscall level, and treating them as "missing" leads to silently
 * dropping projects the user explicitly asked us to remember.
 */
export type Availability = 'available' | 'missing' | 'unknown';

export type AddFailure = 'not-a-directory' | 'unreadable';

export type AddOutcome =
  | { status: 'added'; project: Project }
  | { status: 'already-tracked'; project: Project }
  | { status: 'failed'; path: string; reason: AddFailure };

export type PickResult = {
  canceled: boolean;
  outcomes: AddOutcome[];
};

export const PROJECT_CHANNELS = {
  list: 'projects:list',
  pick: 'projects:pick',
  add: 'projects:add',
  remove: 'projects:remove',
  rename: 'projects:rename',
  setPinned: 'projects:set-pinned',
  touch: 'projects:touch',
  relocate: 'projects:relocate',
  availability: 'projects:availability',
  reveal: 'projects:reveal',
} as const;

/** The surface exposed on `window.gnotes.projects` by the preload bridge. */
export type ProjectsApi = {
  list(): Promise<Project[]>;
  /** Opens a directory picker and tracks whatever the user selects. */
  pick(): Promise<PickResult>;
  add(paths: string[]): Promise<AddOutcome[]>;
  remove(id: string): Promise<void>;
  rename(id: string, name: string): Promise<Project | null>;
  setPinned(id: string, pinned: boolean): Promise<Project | null>;
  /** Records that the project was opened, for ordering the list. */
  touch(id: string): Promise<Project | null>;
  /** Points an existing project at a new directory, preserving its id. */
  relocate(id: string): Promise<Project | null>;
  availability(ids: string[]): Promise<Record<string, Availability>>;
  reveal(id: string): Promise<void>;
};
