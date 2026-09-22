/**
 * Display helpers shared by the views. Presentation only — anything that has
 * to agree with main belongs in `src/shared/projects.ts` instead.
 */
import type { Availability } from '../shared/projects';

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  available: '',
  missing: 'Not found',
  unknown: 'Unreachable',
};

export function formatLastOpened(iso: string | null): string {
  if (!iso) return 'Never opened';
  const opened = new Date(iso);
  const days = Math.floor((Date.now() - opened.getTime()) / 86_400_000);
  if (days === 0) return 'Opened today';
  if (days === 1) return 'Opened yesterday';
  if (days < 30) return `Opened ${days} days ago`;
  return `Opened ${opened.toLocaleDateString()}`;
}

/**
 * How the views are allowed to reach main: run the call, surface a rejection
 * as a notice, then re-read the list. Every button goes through one of these
 * because an unhandled rejection is silent, and a silent rejection looks to
 * the user exactly like a click that did nothing.
 */
export type Act = (action: () => Promise<unknown>) => void;

/**
 * Today as `YYYY-MM-DD`, in the user's local time. Not `toISOString()`, which
 * is UTC and hands the wrong page to anyone whose evening is already
 * tomorrow in Greenwich — or whose morning is still yesterday.
 */
export function today(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
