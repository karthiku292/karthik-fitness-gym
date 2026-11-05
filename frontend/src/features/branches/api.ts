import { api } from "@/lib/api";
import axios from "axios";

export interface Branch {
  id: number;
  gym_id?: number;
  name: string;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  hours?: string | null;
  photo_url?: string | null;
  map_url?: string | null;
  is_active?: boolean;
}

export interface BranchInput {
  name: string;
  address?: string;
  city?: string;
  phone?: string;
  hours?: string;
  photo_url?: string;
  map_url?: string;
}

const pub = axios.create({ baseURL: "/api/v1" });

export async function listPublicBranches(): Promise<Branch[]> {
  const { data } = await pub.get<Branch[]>("/branches/public");
  return data;
}

export async function listBranches(): Promise<Branch[]> {
  const { data } = await api.get<Branch[]>("/branches");
  return data;
}

export async function createBranch(input: BranchInput): Promise<Branch> {
  const { data } = await api.post<Branch>("/branches", input);
  return data;
}

export async function updateBranch(id: number, input: Partial<BranchInput> & { is_active?: boolean }): Promise<Branch> {
  const { data } = await api.put<Branch>(`/branches/${id}`, input);
  return data;
}

export async function deleteBranch(id: number): Promise<void> {
  await api.delete(`/branches/${id}`);
}
