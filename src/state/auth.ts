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
  poll: () => Promise<AuthStatus | null>;
  cancelPoll: () => void;
  reset: () => void;
  logout: () => Promise<void>;
}

// `github_auth_poll` loops on the Rust side (sleeping the device-flow
// interval, handling authorization_pending / slow_down) until it resolves
// with a terminal result, so one awaited call covers the whole flow. The
// generation token lets us cancel: a bumped generation means the eventual
// resolution of an older call is ignored.
let pollGen = 0;

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
    pollGen++;
    set({ loading: true, error: null, deviceCode: null, polling: false });
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
    const gen = ++pollGen;
    set({ polling: true, error: null });
    try {
      const status = await githubAuthPoll(dc.device_code);
      if (gen !== pollGen) return null;
      set({ status, polling: false, deviceCode: null });
      return status;
    } catch (e) {
      if (gen === pollGen) set({ polling: false, error: String(e) });
      throw e;
    }
  },
  cancelPoll: () => {
    pollGen++;
    set({ polling: false });
  },
  reset: () => {
    pollGen++;
    set({ deviceCode: null, error: null, polling: false });
  },
  logout: async () => {
    pollGen++;
    set({ loading: true, polling: false });
    try {
      const status = await githubAuthLogout();
      set({ status, loading: false, deviceCode: null });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },
}));
