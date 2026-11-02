import axios from "axios";
import type { GymBranding, MembershipPlan } from "@/lib/types";

// Public endpoints need no auth token and resolve the primary gym automatically.
const pub = axios.create({ baseURL: "/api/v1" });

export async function getPublicBranding(): Promise<GymBranding | null> {
  try {
    const { data } = await pub.get<GymBranding>("/settings/branding");
    return data;
  } catch {
    return null;
  }
}

export async function getPublicPlans(): Promise<MembershipPlan[]> {
  const { data } = await pub.get<MembershipPlan[]>("/settings/plans");
  return data;
}
