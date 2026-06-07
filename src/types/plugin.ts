export type { Plugin } from "./generated/Plugin";

export type PluginKind =
  | "provider"
  | "subject_backend"
  | "trigger_backend"
  | "transport_backend"
  | "web_ui"
  | "log_storage"
  | "workflow_runner"
  | "queue"
  | string;
