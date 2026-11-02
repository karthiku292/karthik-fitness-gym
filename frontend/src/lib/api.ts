import axios, { AxiosError } from "axios";
import { useAuthStore } from "@/lib/auth";

export const api = axios.create({
  baseURL: "/api/v1",
  headers: { "Content-Type": "application/json" },
});

// Attach access token to every request.
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().tokens?.access_token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401, try a one-time refresh, then retry; otherwise log out.
let refreshing: Promise<string | null> | null = null;

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as typeof error.config & { _retry?: boolean };
    const store = useAuthStore.getState();

    if (
      error.response?.status === 401 &&
      original &&
      !original._retry &&
      store.tokens?.refresh_token
    ) {
      original._retry = true;
      if (!refreshing) {
        refreshing = store
          .refresh()
          .catch(() => null)
          .finally(() => {
            refreshing = null;
          });
      }
      const newToken = await refreshing;
      if (newToken && original.headers) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      }
      store.logout();
    }
    return Promise.reject(error);
  }
);

export function apiErrorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (axios.isAxiosError(err)) {
    // No response => the request never reached the server (server down, CORS,
    // network). Don't disguise this as a validation/auth error.
    if (!err.response) {
      return "Cannot reach the server. Make sure the backend is running on port 8000.";
    }
    const detail = (err.response.data as { detail?: unknown })?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg);
    if (err.response.status >= 500) {
      return "The server encountered an error. Please try again.";
    }
  }
  return fallback;
}
