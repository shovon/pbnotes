/**
 * Tokens for values main keeps to itself: a value is handed out as a token
 * the window can carry, and only main can turn the token back into it. What
 * the token stands for never crosses the bridge, and a token main did not
 * hand out stands for nothing, so the window can name only what main chose
 * to let it name.
 *
 * In memory, and only the latest `keep`: a token outlives neither the
 * process nor many newer ones. Knows nothing of what it keeps.
 */
export function createTokens<T>({ newId, keep }: { newId: () => string; keep: number }) {
  const held = new Map<string, T>();
  return {
    /** A new token for `value`. The oldest is let go once there are more than `keep`. */
    lend(value: T): string {
      const token = newId();
      held.set(token, value);
      for (const oldest of held.keys()) {
        if (held.size <= keep) break;
        held.delete(oldest);
      }
      return token;
    },
    /** What `token` stands for, or undefined for one let go or never handed out. */
    find(token: string): T | undefined {
      return held.get(token);
    },
  };
}
