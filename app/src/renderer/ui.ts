/**
 * What the views share about reaching main.
 */

/**
 * How the views are allowed to reach main: run the call, surface a rejection
 * as a notice, then re-read the list. Every button goes through one of these
 * because an unhandled rejection is silent, and a silent rejection looks to
 * the user exactly like a click that did nothing.
 */
export type Act = (action: () => Promise<unknown>) => void;
