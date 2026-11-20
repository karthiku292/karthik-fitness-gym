import { api } from "@/lib/api";
import type { Page } from "@/lib/types";

export type AttendanceMethod = "qr" | "manual";

export interface QRToken {
  member_id: number;
  token: string;
  rotated_at: string | null;
}

export interface AttendanceRow {
  id: number;
  member_id: number;
  member_name: string;
  member_code: string;
  attendance_date: string;
  check_in_at: string;
  method: AttendanceMethod;
  verified_by: number | null;
}

export interface CheckInResult {
  created: boolean;
  attendance: AttendanceRow;
}

export interface MemberLookup {
  id: number;
  name: string;
  member_code: string;
  phone: string | null;
  status: string;
}

export async function getMyQr(): Promise<QRToken> {
  const { data } = await api.get<QRToken>("/me/qr");
  return data;
}

export async function regenerateMyQr(): Promise<QRToken> {
  const { data } = await api.post<QRToken>("/me/qr/regenerate");
  return data;
}

export async function checkIn(
  body: { token: string } | { member_id: number }
): Promise<CheckInResult> {
  const { data } = await api.post<CheckInResult>("/attendance/check-in", body);
  return data;
}

export async function searchMembers(q: string): Promise<MemberLookup[]> {
  const { data } = await api.get<MemberLookup[]>("/attendance/member-search", {
    params: { q },
  });
  return data;
}

export async function listAttendance(params: {
  date?: string;
  page?: number;
  page_size?: number;
}): Promise<Page<AttendanceRow>> {
  const { data } = await api.get<Page<AttendanceRow>>("/attendance", { params });
  return data;
}

export async function getAttendanceToday(): Promise<number> {
  const { data } = await api.get<{ attendance_today: number }>("/attendance/today");
  return data.attendance_today;
}
