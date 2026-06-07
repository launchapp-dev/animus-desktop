import { invoke } from '@tauri-apps/api/core';
import type { Plugin } from '../types/plugin';

export async function pluginList(): Promise<Plugin[]> {
  return await invoke<Plugin[]>('plugin_list');
}

export async function pluginInstall(name: string): Promise<void> {
  await invoke<void>('plugin_install', { name });
}

export async function pluginInstallDefaults(): Promise<void> {
  await invoke<void>('plugin_install_defaults');
}
