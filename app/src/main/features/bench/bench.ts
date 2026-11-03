/**
 * The bench (DNA.md, "The bench"): this machine's state that only means
 * something to the product, one file per project, in named slots.
 *
 * Knows nothing about what any slot holds. The product declares its slots,
 * each with a decoder, and `index.ts` hands them in; a new piece of state is a
 * new slot, not a change here.
 *
 * Free of `electron`, `node:fs` and `node:sqlite`, so it runs under
 * `node --test` over any `OpenStore`.
 */

/**
 * One named piece of state. `decode` turns whatever arrived (from the
 * renderer, or from disk, written by any build) into the value, or undefined
 * for anything it does not accept. What it returns is what is stored, so a
 * decoder that keeps only the fields it knows also drops the rest.
 */
export type Slot<T> = { decode(raw: unknown): T | undefined };

/** The slots there are, by name. */
export type Slots = ReadonlyMap<string, Slot<unknown>>;

/** One project's slot values, as JSON text, and nothing else of it. */
export type SlotStore = {
  read(slot: string): string | undefined;
  write(slot: string, json: string): void;
};

/** A project's store once opened, to be closed when it is let go. */
export type ProjectStore = SlotStore & { close(): void };

/**
 * Opens one project's store. With `create` false, a project that has never
 * kept anything has none, and gets undefined rather than a new, empty one.
 */
export type OpenStore = (
  projectId: string,
  create: boolean,
) => ProjectStore | undefined;

function slotNamed(slots: Slots, name: string): Slot<unknown> {
  const slot = slots.get(name);
  if (!slot) throw new Error(`The bench has no slot named "${name}"`);
  return slot;
}

/** One project's bench: what it holds is all it can reach. */
export function createBench(store: SlotStore, slots: Slots) {
  /**
   * The value in `name`, or undefined when there is none. A stored value that
   * does not decode, from an older build or a damaged file, is none: losing
   * what is on the bench costs only conveniences.
   */
  function get(name: string): unknown {
    const slot = slotNamed(slots, name);
    const json = store.read(name);
    if (json === undefined) return undefined;
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      return undefined;
    }
    return slot.decode(raw);
  }

  /** Keeps `value` in `name`. Refuses one that does not decode. */
  function set(name: string, value: unknown): void {
    const decoded = slotNamed(slots, name).decode(value);
    if (decoded === undefined) {
      throw new TypeError(`Not a value the bench slot "${name}" accepts`);
    }
    store.write(name, JSON.stringify(decoded));
  }

  return { get, set };
}

/**
 * The bench of whichever project is open when a call lands, never one the
 * caller names. `openProjectId` is asked on every call, with no `await`
 * before the read or the write, so a call lands in the project open at that
 * moment, and calls land in the order they arrive.
 *
 * Holds at most one project's store. A call for another project lets the
 * held one go before opening its own, so no handle ever reaches two
 * projects. A read never creates a store: a project that has kept nothing
 * reads as empty and leaves nothing behind. With nothing open, a read finds
 * nothing and a write is refused.
 */
export function createOpenBench(
  open: OpenStore,
  slots: Slots,
  openProjectId: () => string | undefined,
) {
  let held:
    | { projectId: string; store: ProjectStore; bench: ReturnType<typeof createBench> }
    | undefined;

  /** Lets the held store go: when the open project changes, and on quit. */
  function release(): void {
    held?.store.close();
    held = undefined;
  }

  function benchOf(projectId: string, create: boolean) {
    if (held && held.projectId !== projectId) release();
    if (!held) {
      const store = open(projectId, create);
      if (!store) return undefined;
      held = { projectId, store, bench: createBench(store, slots) };
    }
    return held.bench;
  }

  return {
    get(name: string): unknown {
      slotNamed(slots, name);
      const projectId = openProjectId();
      if (projectId === undefined) return undefined;
      return benchOf(projectId, false)?.get(name);
    },
    set(name: string, value: unknown): void {
      slotNamed(slots, name);
      const projectId = openProjectId();
      if (projectId === undefined) throw new Error("No project is open");
      benchOf(projectId, true)?.set(name, value);
    },
    release,
  };
}

export type OpenBench = ReturnType<typeof createOpenBench>;
