import { invoke } from "@tauri-apps/api/core";

export interface HistoricalEvent {
  ts: string | null;
  level: string | null;
  cat: string | null;
  msg: string | null;
  runId: string | null;
  workflowRef: string | null;
  phaseId: string | null;
  subjectId: string | null;
  scheduleId: string | null;
  durationMs: number | null;
  exitCode: number | null;
  error: string | null;
  model: string | null;
  tool: string | null;
  plugin: string | null;
  agent: string | null;
  role: string | null;
  content: string | null;
  toolName: string | null;
  toolUseId: string | null;
  toolParams: string | null;
  toolResult: string | null;
  toolSuccess: boolean | null;
  verdict: string | null;
  commandProgram: string | null;
  commandArgs: string[];
  raw: string;
}

export function localEventsRead(args: {
  repoPath: string;
  limit?: number;
  sinceTs?: string;
}): Promise<HistoricalEvent[]> {
  return invoke<HistoricalEvent[]>("local_events_read", {
    args: {
      repo_path: args.repoPath,
      limit: args.limit,
      since_ts: args.sinceTs,
    },
  });
}

export interface WorkflowRunSummary {
  wfUuid: string;
  workflowRef: string | null;
  subjectId: string | null;
  startedTs: string | null;
  endedTs: string | null;
  startedMs: number;
  phases: string[];
  runIds: string[];
  eventCount: number;
  errorCount: number;
  status: string;
}

export function localWorkflowRuns(args: {
  repoPath: string;
  limit?: number;
}): Promise<WorkflowRunSummary[]> {
  return invoke<WorkflowRunSummary[]>("local_workflow_runs", {
    args: { repoPath: args.repoPath, limit: args.limit },
  });
}

export function localRunTranscript(args: {
  repoPath: string;
  wfUuid: string;
}): Promise<HistoricalEvent[]> {
  return invoke<HistoricalEvent[]>("local_run_transcript", {
    args: { repoPath: args.repoPath, wfUuid: args.wfUuid },
  });
}
