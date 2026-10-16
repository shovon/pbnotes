/**
 * What the log can tell the user about itself. The ledger owns these; this
 * is here so `shared` and the renderer have one place to take them from.
 *
 * Bundled into the renderer like the rest of `shared`, so: types only.
 */
export type {
  DeviceState,
  DeviceStatus,
  LogStatus,
} from '@pbnotes/append-only-log';
