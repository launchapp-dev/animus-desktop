export interface DaemonStatus {
  installed: boolean;
  running: boolean;
  version: string | null;
  pid: number | null;
  plugins_installed: number;
  binary_path: string | null;
}

export interface InstallProgress {
  stage: 'downloading' | 'extracting' | 'verifying' | 'done' | 'error' | string;
  percent: number | null;
  message: string;
}
