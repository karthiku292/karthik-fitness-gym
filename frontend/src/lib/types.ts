export type Role = "admin" | "trainer" | "member";

export interface User {
  id: number;
  gym_id: number;
  email: string;
  full_name?: string | null;
  phone?: string | null;
  role: Role;
  is_active: boolean;
}

export interface Tokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface GymBranding {
  id: number;
  name: string;
  slug: string;
  logo_url?: string | null;
  primary_color: string;
  accent_color: string;
}

export type MemberStatus = "active" | "inactive" | "expired";
export type PlanType = "monthly" | "quarterly" | "half_yearly" | "yearly" | "custom";
export type MembershipStatus = "active" | "expired" | "paused" | "cancelled";

export interface Member {
  id: number;
  gym_id: number;
  member_code: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  age?: number | null;
  gender?: string | null;
  dob?: string | null;
  joining_date: string;
  photo_url?: string | null;
  address?: string | null;
  emergency_contact?: string | null;
  status: MemberStatus;
  assigned_trainer_id?: number | null;
  user_id?: number | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface MembershipPlan {
  id: number;
  gym_id: number;
  name: string;
  type: PlanType;
  duration_days: number;
  price: number;
  description?: string | null;
  features: string[];
  is_active: boolean;
}

export interface Membership {
  id: number;
  gym_id: number;
  member_id: number;
  plan_id: number;
  start_date: string;
  end_date: string;
  status: MembershipStatus;
  paused_at?: string | null;
  pause_days_used: number;
  auto_renew: boolean;
}
