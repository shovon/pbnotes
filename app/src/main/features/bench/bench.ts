/**
 * The bench (DNA.md, "The bench"): this machine's state that only means
 * something to the product, kept per project in named slots.
 *
 * Knows nothing about what any slot holds. The product declares its slots,
 * each with a decoder, and `index.ts` hands them in; a new piece of state is a
 * new slot, not a change here.
 *
 * Free of `electron` and `node:sqlite`, so it runs under `node --test` over
 * any `SlotStore`.
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

/** Where slot values are kept, as JSON text, and nothing else of it. */
export type SlotStore = {
  read(projectId: string, slot: string): string | undefined;
  write(projectId: string, slot: string, json: string): void;
};

export function createBench(store: SlotStore, slots: Slots) {
  function slotNamed(name: string): Slot<unknown> {
    const slot = slots.get(name);
    if (!slot) throw new Error(`The bench has no slot named "${name}"`);
    return slot;
  }

  /**
   * The value in `name` for `projectId`, or undefined when there is none. A
   * stored value that does not decode, from an older build or a damaged
   * file, is none: losing what is on the bench costs only conveniences.
   */
  function get(projectId: string, name: string): unknown {
    const slot = slotNamed(name);
    const json = store.read(projectId, name);
    if (json === undefined) return undefined;
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      return undefined;
    }
    return slot.decode(raw);
  }

  /** Keeps `value` in `name` for `projectId`. Refuses one that does not decode. */
  function set(projectId: string, name: string, value: unknown): void {
    const decoded = slotNamed(name).decode(value);
    if (decoded === undefined) {
      throw new TypeError(`Not a value the bench slot "${name}" accepts`);
    }
    store.write(projectId, name, JSON.stringify(decoded));
  }

  return { get, set };
}

export type Bench = ReturnType<typeof createBench>;

/**
 * The bench as the renderer reaches it: for whichever project is open when a
 * call lands, never one the caller names. `openProjectId` is asked on every
 * call, with no `await` before the read or the write, so a call lands in the
 * project open at that moment, and calls land in the order they arrive. There
 * is no call that reads or writes more than one project.
 *
 * With nothing open, a read finds nothing and a write is refused: there is no
 * project to keep it for.
 */
export function benchOfOpenProject(
  bench: Pick<Bench, "get" | "set">,
  openProjectId: () => string | undefined,
) {
  return {
    get(name: string): unknown {
      const projectId = openProjectId();
      return projectId === undefined ? undefined : bench.get(projectId, name);
    },
    set(name: string, value: unknown): void {
      const projectId = openProjectId();
      if (projectId === undefined) throw new Error("No project is open");
      bench.set(projectId, name, value);
    },
  };
}

export type OpenBench = ReturnType<typeof benchOfOpenProject>;
