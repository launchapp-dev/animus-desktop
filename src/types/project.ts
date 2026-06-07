export type { Project } from "./generated/Project";
export type { Cycle } from "./generated/Cycle";
export type { CycleStatus } from "./generated/CycleStatus";
export type { Phase } from "./generated/Phase";
export type { PhaseStatus } from "./generated/PhaseStatus";

export type Language =
  | "typescript"
  | "rust"
  | "python"
  | "go"
  | "java"
  | "ruby"
  | "other";

export type Template = "ci-cd";

export interface TemplateRender {
  workflows_yaml: string;
  script: string;
}
