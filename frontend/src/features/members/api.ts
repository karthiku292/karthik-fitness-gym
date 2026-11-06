import { api } from "@/lib/api";
import type { Member, MemberStatus, Page } from "@/lib/types";

export interface MemberInput {
  name: string;
  phone?: string;
  email?: string;
  age?: number;
  gender?: string;
  address?: string;
  emergency_contact?: string;
  assigned_trainer_id?: number | null;
}

export interface ListParams {
  search?: string;
  status?: MemberStatus;
  page?: number;
  page_size?: number;
}

export async function listMembers(params: ListParams): Promise<Page<Member>> {
  const { data } = await api.get<Page<Member>>("/members", { params });
  return data;
}

export async function createMember(input: MemberInput): Promise<Member> {
  const { data } = await api.post<Member>("/members", input);
  return data;
}

export async function updateMember(id: number, input: Partial<MemberInput>): Promise<Member> {
  const { data } = await api.put<Member>(`/members/${id}`, input);
  return data;
}

export async function deactivateMember(id: number): Promise<Member> {
  const { data } = await api.post<Member>(`/members/${id}/deactivate`);
  return data;
}

export async function setMemberCredentials(
  id: number,
  phone: string,
  password: string
): Promise<void> {
  await api.post(`/members/${id}/credentials`, { phone, password });
}
