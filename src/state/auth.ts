import { create } from "zustand";
import {
  githubAuthLogout,
  githubAuthPoll,
  githubAuthStart,
  githubAuthStatus,
} from "../api/_invoke";
import type { AuthStatus, DeviceCodeResponse } from "../types/contracts";

interface AuthState {
  status: AuthStatus | null;
  deviceCode: DeviceCodeResponse | null;
  polling: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  startDeviceFlow: () => Promise<DeviceCodeResponse>;
  poll: () => Promise<AuthStatus>;
  reset: () => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: null,
  deviceCode: null,
  polling: false,
  loading: false,
  error: null,
  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const status = await githubAuthStatus();
      set({ status, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },
  startDeviceFlow: async () => {
    set({ loading: true, error: null, deviceCode: null });
    try {
      const dc = await githubAuthStart();
      set({ deviceCode: dc, loading: false });
      return dc;
    } catch (e) {
      set({ error: String(e), loading: false });
      throw e;
    }
  },
  poll: async () => {
    const dc = get().deviceCode;
    if (!dc) throw new Error("No device code in progress");
    set({ polling: true });
    try {
      const status = await githubAuthPoll(dc.device_code);
      set({ status, polling: false });
      return status;
    } catch (e) {
      set({ polling: false, error: String(e) });
      throw e;
    }
  },
  reset: () => set({ deviceCode: null, error: null }),
  logout: async () => {
    set({ loading: true });
    try {
      const status = await githubAuthLogout();
      set({ status, loading: false, deviceCode: null });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },
}));
