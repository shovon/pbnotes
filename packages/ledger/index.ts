/**
 * The package's one entry point. `logSize`, `segmentName` and `MARKER` are
 * here for a consumer's tests, which read the files to check what was written.
 */
export {
  beforeOpen,
  bindDevice,
  closeLedgers,
  defineFold,
  deviceOf,
  onArrival,
} from './project-ledger/project-ledger.ts';
export type {
  DeviceBinding,
  Fold,
  LedgerRef,
  View,
} from './project-ledger/project-ledger.ts';
export {
  LedgerRefusedError,
  MARKER,
  adoptLedger,
  createLedger,
  inspect,
} from './marker/marker.ts';
export type { Refusal } from './marker/marker.ts';
export { logSize, segmentName } from './event-log/event-log.ts';
export type { DeviceMemory, LogEvent } from './event-log/event-log.ts';
export type {
  DeviceState,
  DeviceStatus,
  LogStatus,
  Unhandled,
  ViewStatus,
} from './status.ts';
