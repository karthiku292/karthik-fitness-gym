import { api } from "@/lib/api";

export type PlanKind = "workout" | "diet";

export interface Plan {
  id: number;
  gym_id: number;
  name: string;
  description?: string | null;
  details?: string | null;
}

export interface PlanInput {
  name: string;
  description?: string;
  details?: string;
}

const base = (k: PlanKind) => (k === "workout" ? "/workout-plans" : "/diet-plans");

export async function listPlans(kind: PlanKind): Promise<Plan[]> {
  const { data } = await api.get<Plan[]>(base(kind));
  return data;
}
export async function createPlan(kind: PlanKind, input: PlanInput): Promise<Plan> {
  const { data } = await api.post<Plan>(base(kind), input);
  return data;
}
export async function updatePlan(kind: PlanKind, id: number, input: PlanInput): Promise<Plan> {
  const { data } = await api.put<Plan>(`${base(kind)}/${id}`, input);
  return data;
}
export async function deletePlan(kind: PlanKind, id: number): Promise<void> {
  await api.delete(`${base(kind)}/${id}`);
}
export async function assignPlan(kind: PlanKind, id: number, member_id: number): Promise<void> {
  await api.post(`${base(kind)}/${id}/assign`, { member_id });
}

export async function getMyWorkout(): Promise<Plan | null> {
  const { data } = await api.get<Plan | null>("/me/workout");
  return data;
}
export async function getMyDiet(): Promise<Plan | null> {
  const { data } = await api.get<Plan | null>("/me/diet");
  return data;
}
