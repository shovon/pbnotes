import { ipcMain } from "electron";
import { BENCH_CHANNELS } from "../../../shared/bench";
import { requireString } from "../../ipc";
import type { OpenBench } from "./bench";

/**
 * The `bench:*` channels: the slot name checked as it arrives, then handed to
 * the bench of the open project (`createOpenBench`). The value is checked
 * by the slot's decoder there.
 */
export function registerBenchIpc(bench: Pick<OpenBench, "get" | "set">): void {
  ipcMain.handle(BENCH_CHANNELS.get, (_event, slot: unknown) =>
    bench.get(requireString(slot, "slot")),
  );

  ipcMain.handle(BENCH_CHANNELS.set, (_event, slot: unknown, value: unknown) =>
    bench.set(requireString(slot, "slot"), value),
  );
}
