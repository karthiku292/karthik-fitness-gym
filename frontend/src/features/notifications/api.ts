import { api } from "@/lib/api";
import type { Page } from "@/lib/types";

// The manual-send member picker reuses the existing member search rather than
// adding a duplicate endpoint (design: Member picker reuse). Re-exported here so
// the notifications feature's data access lives behind one module.
export { searchMembers } from "@/features/attendance/api";
export type { MemberLookup } from "@/features/attendance/api";

export type Channel = "whatsapp" | "email";
export type EventType = "welcome" | "membership_expiry" | "payment_receipt";
export type NotificationStatus = "queued" | "sent" | "failed";

export interface NotificationTemplate {
  id: number;
  gym_id: number;
  event_type: EventType;
  channel: Channel;
  subject: string | null;
  body: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TemplateInput {
  event_type: EventType;
  channel: Channel;
  subject?: string | null;
  body: string;
}

export interface NotificationLog {
  id: number;
  gym_id: number;
  member_id: number | null;
  member_name: string | null;
  channel: Channel;
  event_type: string;
  status: NotificationStatus;
  provider_ref: string | null;
  error: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface LogFilters {
  status?: NotificationStatus;
  channel?: Channel;
  event_type?: EventType;
  member_id?: number;
  page?: number;
  page_size?: number;
}

export interface ManualSend {
  member_id: number;
  template_id?: number;
  event_type?: EventType;
  channel?: Channel;
  membership_id?: number;
  payment_id?: number;
}

export interface ReminderRunResult {
  memberships_selected: number;
  notifications_created: number;
  channel: Channel;
  within_days: number;
}

export async function listTemplates(): Promise<NotificationTemplate[]> {
  const { data } = await api.get<NotificationTemplate[]>("/notifications/templates");
  return data;
}

export async function createTemplate(input: TemplateInput): Promise<NotificationTemplate> {
  const { data } = await api.post<NotificationTemplate>("/notifications/templates", input);
  return data;
}

export async function updateTemplate(
  id: number,
  input: Partial<TemplateInput> & { is_active?: boolean }
): Promise<NotificationTemplate> {
  const { data } = await api.put<NotificationTemplate>(`/notifications/templates/${id}`, input);
  return data;
}

export async function deleteTemplate(id: number): Promise<void> {
  await api.delete(`/notifications/templates/${id}`);
}

export async function listNotifications(params: LogFilters): Promise<Page<NotificationLog>> {
  const { data } = await api.get<Page<NotificationLog>>("/notifications", { params });
  return data;
}

export async function sendNotification(input: ManualSend): Promise<NotificationLog> {
  const { data } = await api.post<NotificationLog>("/notifications/send", input);
  return data;
}

export async function runReminders(input: {
  within_days: number;
  channel: Channel;
}): Promise<ReminderRunResult> {
  const { data } = await api.post<ReminderRunResult>("/notifications/run-reminders", input);
  return data;
}
