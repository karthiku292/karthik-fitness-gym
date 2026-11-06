import { api } from "@/lib/api";
import axios from "axios";
import { TRAINERS } from "@/features/public/content";

export interface Trainer {
  id: number;
  gym_id?: number;
  name: string;
  specialization?: string | null;
  bio?: string | null;
  photo_url?: string | null;
  phone?: string | null;
  email?: string | null;
  hourly_rate?: number | null;
  is_active?: boolean;
}

export interface TrainerInput {
  name: string;
  specialization?: string;
  bio?: string;
  photo_url?: string;
  phone?: string;
  email?: string;
  hourly_rate?: number;
}

/** Unified shape used by the public site. */
export interface DisplayTrainer {
  name: string;
  specialization: string;
  bio: string;
  photo: string;
}

const pub = axios.create({ baseURL: "/api/v1" });

/** Public trainers from the DB; falls back to editorial defaults if none set. */
export async function getDisplayTrainers(): Promise<DisplayTrainer[]> {
  try {
    const { data } = await pub.get<Trainer[]>("/trainers/public");
    if (data.length > 0) {
      return data.map((t) => ({
        name: t.name,
        specialization: t.specialization ?? "",
        bio: t.bio ?? "",
        photo: t.photo_url ?? "",
      }));
    }
  } catch {
    /* fall through to defaults */
  }
  return TRAINERS.map((t) => ({
    name: t.name,
    specialization: t.specialization,
    bio: t.bio,
    photo: t.image,
  }));
}

export async function listTrainers(): Promise<Trainer[]> {
  const { data } = await api.get<Trainer[]>("/trainers");
  return data;
}

export async function createTrainer(input: TrainerInput): Promise<Trainer> {
  const { data } = await api.post<Trainer>("/trainers", input);
  return data;
}

export async function updateTrainer(id: number, input: Partial<TrainerInput> & { is_active?: boolean }): Promise<Trainer> {
  const { data } = await api.put<Trainer>(`/trainers/${id}`, input);
  return data;
}

export async function deactivateTrainer(id: number): Promise<void> {
  await api.post(`/trainers/${id}/deactivate`);
}
