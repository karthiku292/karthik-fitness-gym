import { api } from "@/lib/api";

export interface DashboardSummary {
  total_members: number;
  active_members: number;
  expired: number;
  monthly_revenue: number;
  pending_payments: number;
}

export interface MonthlyRevenuePoint {
  month: string;
  revenue: number;
}

export interface MonthlySignupPoint {
  month: string;
  signups: number;
}

export interface DailyAttendancePoint {
  date: string;
  count: number;
}

export interface PlanRevenuePoint {
  plan: string;
  revenue: number;
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const { data } = await api.get<DashboardSummary>("/reports/summary");
  return data;
}

export async function getRevenueTrend(): Promise<MonthlyRevenuePoint[]> {
  const { data } = await api.get<MonthlyRevenuePoint[]>("/reports/revenue-trend");
  return data;
}

export async function getSignupTrend(): Promise<MonthlySignupPoint[]> {
  const { data } = await api.get<MonthlySignupPoint[]>("/reports/signup-trend");
  return data;
}

export async function getAttendanceTrend(): Promise<DailyAttendancePoint[]> {
  const { data } = await api.get<DailyAttendancePoint[]>("/reports/attendance-trend");
  return data;
}

export async function getRevenueByPlan(): Promise<PlanRevenuePoint[]> {
  const { data } = await api.get<PlanRevenuePoint[]>("/reports/revenue-by-plan");
  return data;
}
