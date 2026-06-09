import { invoke } from "@tauri-apps/api/core";
import type { AnimusCliResult } from "./animus";

export interface SecretListData {
  scope: string;
  service: string;
  keys: string[];
  index_path: string;
}

export interface SecretGetData {
  key: string;
  value: string;
}

export interface SecretSetData {
  ok: boolean;
  key: string;
  service: string;
}

export interface SecretRmData {
  removed: boolean;
  key: string;
}

export interface SecretImportEnvData {
  imported: number;
  skipped: number;
  source: string;
}

export interface SecretExportEnvData {
  written: number;
  path: string;
}

export function animusSecretList(path: string): Promise<AnimusCliResult<SecretListData>> {
  return invoke<AnimusCliResult<SecretListData>>("animus_secret_list", { path });
}

export function animusSecretSet(
  path: string,
  key: string,
  value: string,
): Promise<AnimusCliResult<SecretSetData>> {
  return invoke<AnimusCliResult<SecretSetData>>("animus_secret_set", { path, key, value });
}

export function animusSecretGet(
  path: string,
  key: string,
): Promise<AnimusCliResult<SecretGetData>> {
  return invoke<AnimusCliResult<SecretGetData>>("animus_secret_get", { path, key });
}

export function animusSecretRm(
  path: string,
  key: string,
): Promise<AnimusCliResult<SecretRmData>> {
  return invoke<AnimusCliResult<SecretRmData>>("animus_secret_rm", { path, key });
}

export function animusSecretImportEnv(
  path: string,
  file: string | null,
  overwrite: boolean,
): Promise<AnimusCliResult<SecretImportEnvData>> {
  return invoke<AnimusCliResult<SecretImportEnvData>>("animus_secret_import_env", {
    path,
    file,
    overwrite,
  });
}

export function animusSecretExportEnv(
  path: string,
  file: string | null,
): Promise<AnimusCliResult<SecretExportEnvData>> {
  return invoke<AnimusCliResult<SecretExportEnvData>>("animus_secret_export_env", {
    path,
    file,
  });
}
