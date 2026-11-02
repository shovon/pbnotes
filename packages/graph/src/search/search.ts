/**
 * Ranking titles against a query. Knows nothing of where the titles came
 * from: a caller hands it every title it wants offered.
 */
import { canonicalize } from "../canonicalize/canonicalize.ts";

/**
 * The titles that contain `query`, ignoring case: prefix matches first, then
 * the rest, each A to Z, at most `limit`, each once.
 */
export function search(titles: Iterable<string>, query: string, limit: number): string[] {
  const q = canonicalize(query);
  return [...new Set(titles)]
    .map((title) => ({ title, at: canonicalize(title).indexOf(q) }))
    .filter(({ at }) => at !== -1)
    .sort((a, b) => Number(a.at !== 0) - Number(b.at !== 0) || a.title.localeCompare(b.title))
    .slice(0, limit)
    .map(({ title }) => title);
}
