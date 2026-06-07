import { invoke } from '@tauri-apps/api/core';
import type {
  AuthStatus,
  DeviceCodeResponse,
  Repo,
  Webhook,
} from '../types/github';

export async function githubAuthStart(): Promise<DeviceCodeResponse> {
  return await invoke('github_auth_start');
}

export async function githubAuthPoll(device_code: string): Promise<AuthStatus> {
  return await invoke('github_auth_poll', { deviceCode: device_code });
}

export async function githubAuthStatus(): Promise<AuthStatus> {
  return await invoke('github_auth_status');
}

export async function githubLogout(): Promise<void> {
  await invoke('github_logout');
}

export async function githubListRepos(): Promise<Repo[]> {
  return await invoke('github_list_repos');
}

export async function githubRegisterWebhook(
  repo_full_name: string,
  payload_url: string,
  secret: string,
  events: string[],
): Promise<Webhook> {
  return await invoke('github_register_webhook', {
    repoFullName: repo_full_name,
    payloadUrl: payload_url,
    secret,
    events,
  });
}

export async function githubListWebhooks(
  repo_full_name: string,
): Promise<Webhook[]> {
  return await invoke('github_list_webhooks', {
    repoFullName: repo_full_name,
  });
}

export async function githubDeleteWebhook(
  repo_full_name: string,
  hook_id: number,
): Promise<void> {
  await invoke('github_delete_webhook', {
    repoFullName: repo_full_name,
    hookId: hook_id,
  });
}
