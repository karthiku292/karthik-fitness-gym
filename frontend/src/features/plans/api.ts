import { api } from "@/lib/api";
import type { MembershipPlan, PlanType } from "@/lib/types";

export interface PlanInput {
  name: string;
  type: PlanType;
  duration_days: number;
  price: number;
  description?: string;
  features?: string[];
  is_active?: boolean;
}

export async function listPlans(activeOnly = false): Promise<MembershipPlan[]> {
  const { data } = await api.get<MembershipPlan[]>("/plans", {
    params: { active_only: activeOnly },
  });
  return data;
}

export async function createPlan(input: PlanInput): Promise<MembershipPlan> {
  const { data } = await api.post<MembershipPlan>("/plans", input);
  return data;
}

export async function updatePlan(id: number, input: Partial<PlanInput>): Promise<MembershipPlan> {
  const { data } = await api.put<MembershipPlan>(`/plans/${id}`, input);
  return data;
}

export async function deactivatePlan(id: number): Promise<void> {
  await api.delete(`/plans/${id}`);
}
