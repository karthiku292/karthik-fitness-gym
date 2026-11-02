import { create } from "zustand";
import { persist } from "zustand/middleware";
import axios from "axios";
import type { Tokens, User } from "@/lib/types";

interface AuthState {
  tokens: Tokens | null;
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loadMe: () => Promise<void>;
  refresh: () => Promise<string | null>;
  logout: () => void;
}

const raw = axios.create({ baseURL: "/api/v1" });

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      tokens: null,
      user: null,
      loading: false,

      async login(email, password) {
        // FastAPI OAuth2 expects form-encoded username/password.
        const body = new URLSearchParams();
        body.append("username", email);
        body.append("password", password);
        const { data } = await raw.post<Tokens>("/auth/login", body, {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
        set({ tokens: data });
        await get().loadMe();
      },

      async loadMe() {
        const token = get().tokens?.access_token;
        if (!token) return;
        const { data } = await raw.get<User>("/auth/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        set({ user: data });
      },

      async refresh() {
        const refreshToken = get().tokens?.refresh_token;
        if (!refreshToken) return null;
        try {
          const { data } = await raw.post<Tokens>("/auth/refresh", {
            refresh_token: refreshToken,
          });
          set({ tokens: data });
          return data.access_token;
        } catch {
          return null;
        }
      },

      logout() {
        set({ tokens: null, user: null });
      },
    }),
    { name: "gym-auth" }
  )
);
