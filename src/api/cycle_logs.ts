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
  let channel: Channel<LogLine> | null = new Channel<LogLine>();
  channel.onmessage = handler;
  await invoke("cycle_logs_subscribe", { cycleId, onEvent: channel });
  return {
    close: () => {
      // No backend unsubscribe command exists; the Rust stream stops only
      // when the process ends. Detach the handler and drop the channel
      // reference so closed subscriptions can't retain the consumer.
      if (channel) {
        channel.onmessage = () => {};
        channel = null;
      }
    },
  };
}

export type { LogLine };
