/**
 * Work that has started and not yet finished, and a way to wait for all of
 * it. Knows nothing of what the work is.
 *
 * `settled` waits only for what was tracked before it was called, so work
 * that keeps arriving never holds it up.
 */
export function createInFlight() {
  const pending = new Set<Promise<void>>();

  /** Tracks `work` until it resolves or rejects, and hands it back as it was. */
  function track<T>(work: Promise<T>): Promise<T> {
    const done = work.then(
      (): void => undefined,
      (): void => undefined,
    );
    pending.add(done);
    void done.then(() => pending.delete(done));
    return work;
  }

  /** Resolves once everything tracked so far has finished; never rejects. */
  async function settled(): Promise<void> {
    await Promise.all([...pending]);
  }

  return { track, settled };
}

export type InFlight = ReturnType<typeof createInFlight>;
