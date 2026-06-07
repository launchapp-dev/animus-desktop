export interface DeviceCodeResponse {
  user_code: string;
  verification_uri: string;
  device_code: string;
  interval: number;
  expires_in: number;
}

export interface AuthStatus {
  logged_in: boolean;
  login: string | null;
  avatar_url: string | null;
}

export interface Repo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  description: string | null;
  language: string | null;
  updated_at: string;
}

export interface Webhook {
  id: number;
  url: string;
  events: string[];
  active: boolean;
}
