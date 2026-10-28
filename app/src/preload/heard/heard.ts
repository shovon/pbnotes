/**
 * The bridge's half of "a call resolves once `onChanged` has heard the state
 * it led to" (`PagesApi` in `src/shared/pages.ts`).
 *
 * Electron does not keep that order. `webContents.send` reaches the renderer
 * down one Mojo pipe and an `invoke` reply down another, and Mojo orders
 * messages within a pipe, never across two. The send pipe is opened the
 * first time main sends to a frame, so that first state reliably arrives
 * after the reply it was sent before; later ones usually arrive in order,
 * but only by luck.
 *
 * So main numbers every state it sends, and a call's reply is the number of
 * the state it led to. This holds the call until that state has been
 * delivered to every listener.
 *
 * Pure bookkeeping, no `electron`: the preload feeds it what arrives.
 */
export function createHeard<S>() {
  const listeners = new Set<(state: S) => void>();
  /** The number of the last state delivered here, 0 before the first. */
  let last = 0;
  let waiting: { n: number; settle: () => void }[] = [];

  return {
    /** Calls `listener` with every state delivered. Returns an unsubscribe. */
    listen(listener: (state: S) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /**
     * State number `n` arrived: every listener hears it, and then every call
     * waiting on it, or on one before it, carries on. Settled even if a
     * listener throws, so one bad listener never leaves a call hanging.
     */
    deliver(state: S, n: number): void {
      try {
        for (const listener of [...listeners]) listener(state);
      } finally {
        last = Math.max(last, n);
        const ready = waiting.filter((it) => it.n <= last);
        waiting = waiting.filter((it) => it.n > last);
        for (const it of ready) it.settle();
      }
    },

    /**
     * Resolves once state `n` has been delivered. A reply with no number is a
     * call that sent nothing (main could not read the ledger), so there is
     * nothing to wait for.
     */
    until(n: number | undefined): Promise<void> {
      if (n === undefined || n <= last) return Promise.resolve();
      return new Promise((settle) => waiting.push({ n, settle }));
    },
  };
}
