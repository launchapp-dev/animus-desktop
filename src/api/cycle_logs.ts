import { invoke, Channel } from "@tauri-apps/api/core";
import type { LogLine } from "../types/generated/LogLine";

export type CycleLogHandler = (line: LogLine) => void;

export interface CycleLogSubscription {
  close: () => void;
}

export async function subscribeCycleLogs(
  cycleId: string,
  handler: CycleLogHandler,
): Promise<CycleLogSubscription> {
  const channel = new Channel<LogLine>();
  channel.onmessage = handler;
  await invoke("cycle_logs_subscribe", { cycleId, onEvent: channel });
  return {
    close: () => {
      channel.onmessage = () => {};
    },
  };
}

export type { LogLine };
