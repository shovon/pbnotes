/**
 * What the log can tell the user about itself.
 *
 * The folder is shared with whatever sync tool the user pointed at it, so
 * "everything loaded" is not a safe assumption and never becomes one. These
 * types exist so the app can say which devices it has read, how far, and what
 * it skipped — the sin that made the original single-writer bug invisible was
 * skipping a file without a word.
 *
 * Bundled into the renderer like the rest of `shared`, so: types only.
 */

export type DeviceState =
  /** Read to the end of what is there. */
  | 'ok'
  /** Read as far as it could. The rest is probably still arriving. */
  | 'stalled'
  /** Could not be read at all: placeholder, selective sync, gone. */
  | 'unavailable'
  /** Writing events dated far enough ahead that we will not trust its clock. */
  | 'clockSuspect';

export type DeviceStatus = {
  device: string;
  /** Last `seq` folded from this device. */
  folded: number;
  state: DeviceState;
  /** Byte offset and reason when stalled; the offending `l` when suspect. */
  detail?: string;
};

/** An event type, or a payload version, this build does not understand. */
export type Unhandled = { type: string; v: number; count: number };

export type LogStatus = {
  devices: DeviceStatus[];
  /** Paths skipped: root-level segments, conflicted copies, junk. */
  ignored: string[];
};

/**
 * What the fold saw, which is the log's status plus what the *reducer* could
 * not use. Only the reducer knows which event types it handles, so only the
 * projection can fill this in.
 */
export type ViewStatus = LogStatus & { unhandled: Unhandled[] };
