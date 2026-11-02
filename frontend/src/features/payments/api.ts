import { api } from "@/lib/api";
import type { Page } from "@/lib/types";

export type PaymentMethod = "cash" | "upi" | "card" | "razorpay";
export type PaymentStatus = "paid" | "pending" | "refunded";

export interface Payment {
  id: number;
  gym_id: number;
  member_id: number;
  membership_id?: number | null;
  txn_code: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  paid_at?: string | null;
  razorpay_ref?: string | null;
  notes?: string | null;
  created_at: string;
  member_name?: string | null;
  member_code?: string | null;
}

export interface RevenueSummary {
  today: number;
  this_month: number;
  this_year: number;
  pending: number;
  by_month: { period: string; total: number; count: number }[];
  by_method: Record<string, number>;
}

export interface PaymentInput {
  member_id: number;
  amount: number;
  method: PaymentMethod;
  membership_id?: number | null;
  status?: PaymentStatus;
  notes?: string;
}

export interface ListParams {
  member_id?: number;
  status?: PaymentStatus;
  method?: PaymentMethod;
  page?: number;
  page_size?: number;
}

export async function listPayments(params: ListParams): Promise<Page<Payment>> {
  const { data } = await api.get<Page<Payment>>("/payments", { params });
  return data;
}

export async function createPayment(input: PaymentInput): Promise<Payment> {
  const { data } = await api.post<Payment>("/payments", input);
  return data;
}

export async function refundPayment(id: number, reason?: string): Promise<Payment> {
  const { data } = await api.post<Payment>(`/payments/${id}/refund`, { reason });
  return data;
}

export async function getRevenueSummary(): Promise<RevenueSummary> {
  const { data } = await api.get<RevenueSummary>("/payments/summary");
  return data;
}

/** Fetch the PDF receipt with auth and open it in a new tab. */
export async function openReceipt(id: number, txn: string): Promise<void> {
  const res = await api.get(`/payments/${id}/receipt`, { responseType: "blob" });
  const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener";
  a.download = `receipt-${txn}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
