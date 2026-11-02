import { api } from "@/lib/api";
import type { Member } from "@/lib/types";
import type { Payment } from "@/features/payments/api";

export interface PortalMembership {
  id: number;
  plan_id: number;
  plan_name: string;
  start_date: string;
  end_date: string;
  status: string;
  days_left: number;
}

export interface PortalAttendance {
  attendance_date: string;
  check_in_at: string;
}

export async function getMyProfile(): Promise<Member> {
  const { data } = await api.get<Member>("/me/profile");
  return data;
}

export async function getMyMembership(): Promise<PortalMembership | null> {
  const { data } = await api.get<PortalMembership | null>("/me/membership");
  return data;
}

export async function getMyPayments(): Promise<Payment[]> {
  const { data } = await api.get<Payment[]>("/me/payments");
  return data;
}

export async function getMyAttendance(): Promise<PortalAttendance[]> {
  const { data } = await api.get<PortalAttendance[]>("/me/attendance");
  return data;
}
