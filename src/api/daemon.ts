import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { DaemonStatus, InstallProgress } from '../types/daemon';

export async function daemonStatus(): Promise<DaemonStatus> {
  return await invoke<DaemonStatus>('daemon_status');
}

export async function daemonInstall(): Promise<DaemonStatus> {
  return await invoke<DaemonStatus>('daemon_install');
}

export async function daemonStart(): Promise<DaemonStatus> {
  return await invoke<DaemonStatus>('daemon_start');
}

export async function daemonStop(): Promise<DaemonStatus> {
  return await invoke<DaemonStatus>('daemon_stop');
}

export async function daemonRestart(): Promise<DaemonStatus> {
  return await invoke<DaemonStatus>('daemon_restart');
}

export function onInstallProgress(
  handler: (progress: InstallProgress) => void,
): Promise<UnlistenFn> {
  return listen<InstallProgress>('install-progress', (event) => handler(event.payload));
}
