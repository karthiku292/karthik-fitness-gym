import axios from "axios";
import { BRAND } from "@/brand";
import type { GymBranding, MembershipPlan } from "@/lib/types";

// Public endpoints need no auth token.
const pub = axios.create({ baseURL: "/api/v1" });

export async function getPublicBranding(): Promise<GymBranding | null> {
  try {
    const { data } = await pub.get<GymBranding>(`/settings/public/${BRAND.gymSlug}`);
    return data;
  } catch {
    return null;
  }
}

export async function getPublicPlans(): Promise<MembershipPlan[]> {
  const { data } = await pub.get<MembershipPlan[]>(`/settings/public/${BRAND.gymSlug}/plans`);
  return data;
}
