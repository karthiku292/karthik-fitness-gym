import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { BRAND } from "@/brand";
import { getPublicBranding } from "@/features/public/api";

export interface Branding {
  name: string;
  short: string;
  tagline: string;
  logoUrl: string | null;
  primaryColor: string;
  accentColor: string;
  email: string;
  phone: string;
  address: string;
  hours: string;
  currency: string;
  socials: { instagram?: string; facebook?: string; youtube?: string; x?: string };
  loaded: boolean;
}

const fallback: Branding = {
  name: BRAND.name,
  short: BRAND.short,
  tagline: BRAND.tagline,
  logoUrl: null,
  primaryColor: "#080808",
  accentColor: "#B794F6",
  email: BRAND.email,
  phone: BRAND.phone,
  address: BRAND.address,
  hours: BRAND.hours,
  currency: "INR",
  socials: BRAND.socials,
  loaded: false,
};

const BrandingContext = createContext<Branding>(fallback);

export const useBranding = () => useContext(BrandingContext);

/* ---------- color helpers ---------- */
function hexChannels(hex: string): [number, number, number] | null {
  const m = hex.trim().replace("#", "");
  if (![3, 6].includes(m.length)) return null;
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const mix = (c: [number, number, number], target: number, amt: number): [number, number, number] =>
  [clamp(c[0] + (target - c[0]) * amt), clamp(c[1] + (target - c[1]) * amt), clamp(c[2] + (target - c[2]) * amt)];

function applyAccent(accent: string) {
  const base = hexChannels(accent);
  if (!base) return;
  const light = mix(base, 255, 0.4); // lighter shade
  const dark = mix(base, 0, 0.18); // darker shade
  const root = document.documentElement;
  root.style.setProperty("--brand", base.join(" "));
  root.style.setProperty("--brand-light", light.join(" "));
  root.style.setProperty("--brand-dark", dark.join(" "));
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<Branding>(fallback);

  useEffect(() => {
    let active = true;
    getPublicBranding().then((g) => {
      if (!active || !g) return;
      const extra = (g.settings ?? {}) as {
        tagline?: string; hours?: string;
        socials?: Branding["socials"]; short?: string;
      };
      const next: Branding = {
        name: g.name || fallback.name,
        short: extra.short || g.name || fallback.short,
        tagline: extra.tagline || fallback.tagline,
        logoUrl: g.logo_url ?? null,
        primaryColor: g.primary_color || fallback.primaryColor,
        accentColor: g.accent_color || fallback.accentColor,
        email: g.email || fallback.email,
        phone: g.phone || fallback.phone,
        address: g.address || fallback.address,
        hours: extra.hours || fallback.hours,
        currency: g.currency || fallback.currency,
        socials: extra.socials || fallback.socials,
        loaded: true,
      };
      applyAccent(next.accentColor);
      document.title = `${next.name} — ${next.tagline}`;
      setBranding(next);
    });
    return () => {
      active = false;
    };
  }, []);

  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}
