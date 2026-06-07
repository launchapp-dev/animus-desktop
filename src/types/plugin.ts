export type PluginKind =
  | 'provider'
  | 'subject_backend'
  | 'trigger_backend'
  | 'transport_backend'
  | 'web_ui'
  | 'log_storage'
  | 'workflow_runner'
  | 'queue'
  | string;

export interface Plugin {
  name: string;
  kind: PluginKind;
  version: string;
  repo: string;
  installed: boolean;
}
