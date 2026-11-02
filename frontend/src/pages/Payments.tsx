import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { Plus, Download, RotateCcw, TrendingUp, CalendarDays, Wallet, Clock } from "lucide-react";
import {
  Badge, Button, Card, EmptyState, ErrorState, Input, Modal, Select, Skeleton,
} from "@/components/ui";
import type { Member, Page } from "@/lib/types";
import { apiErrorMessage } from "@/lib/api";
import { listMembers } from "@/features/members/api";
import {
  Payment, PaymentInput, PaymentMethod, PaymentStatus, RevenueSummary,
  createPayment, getRevenueSummary, listPayments, openReceipt, refundPayment,
} from "@/features/payments/api";

const STATUS_TONE: Record<PaymentStatus, "success" | "warning" | "danger"> = {
  paid: "success",
  pending: "warning",
  refunded: "danger",
};

const inr = (n: number) => "₹" + Number(n).toLocaleString("en-IN");

export function PaymentsPage() {
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [data, setData] = useState<Page<Payment> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusF, setStatusF] = useState<PaymentStatus | "">("");
  const [methodF, setMethodF] = useState<PaymentMethod | "">("");
  const [page, setPage] = useState(1);

  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [memberQuery, setMemberQuery] = useState("");
  const [form, setForm] = useState<PaymentInput>({ member_id: 0, amount: 0, method: "cash" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [s, p] = await Promise.all([
        getRevenueSummary(),
        listPayments({
          status: statusF || undefined,
          method: methodF || undefined,
          page,
          page_size: 10,
        }),
      ]);
      setSummary(s);
      setData(p);
    } catch (e) {
      setError(apiErrorMessage(e, "Could not load payments"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusF, methodF, page]);

  async function openModal() {
    setForm({ member_id: 0, amount: 0, method: "cash" });
    setFormError(null);
    setOpen(true);
    try {
      const res = await listMembers({ page: 1, page_size: 100 });
      setMembers(res.items);
    } catch {
      /* members optional */
    }
  }

  const filteredMembers = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) => m.name.toLowerCase().includes(q) || m.member_code.toLowerCase().includes(q) || (m.phone ?? "").includes(q)
    );
  }, [members, memberQuery]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.member_id) {
      setFormError("Please select a member.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await createPayment({ ...form, amount: Number(form.amount) });
      setOpen(false);
      setPage(1);
      await load();
    } catch (e) {
      setFormError(apiErrorMessage(e, "Could not record payment"));
    } finally {
      setSaving(false);
    }
  }

  async function onRefund(p: Payment) {
    if (!confirm(`Refund ${inr(p.amount)} (${p.txn_code})?`)) return;
    try {
      await refundPayment(p.id);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, "Could not refund"));
    }
  }

  const chartData = (summary?.by_month ?? []).map((m) => ({ month: m.period.slice(5), total: m.total }));
  const kpis = summary
    ? [
        { label: "Today", value: summary.today, Icon: CalendarDays },
        { label: "This Month", value: summary.this_month, Icon: TrendingUp },
        { label: "This Year", value: summary.this_year, Icon: Wallet },
        { label: "Pending", value: summary.pending, Icon: Clock },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Payments</h1>
          <p className="text-sm text-muted">Record payments, issue receipts and track revenue</p>
        </div>
        <Button onClick={openModal}>
          <Plus className="h-4 w-4" /> Record Payment
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {loading && !summary
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)
          : kpis.map(({ label, value, Icon }) => (
              <Card key={label} className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted">{label}</p>
                  <p className="mt-1 text-xl font-bold">{inr(value)}</p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/15 text-brand">
                  <Icon className="h-5 w-5" />
                </div>
              </Card>
            ))}
      </div>

      {/* Revenue chart */}
      <Card>
        <h2 className="mb-4 font-display text-lg font-semibold uppercase">Monthly Revenue</h2>
        {chartData.length === 0 ? (
          <EmptyState title="No revenue yet" hint="Recorded payments will appear here." />
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2A2A2A" vertical={false} />
                <XAxis dataKey="month" stroke="#9A9A9A" fontSize={12} />
                <YAxis stroke="#9A9A9A" fontSize={12} tickFormatter={(v) => `₹${v / 1000}k`} />
                <Tooltip
                  contentStyle={{ background: "#151515", border: "1px solid #2A2A2A", borderRadius: 12, color: "#fff" }}
                  formatter={(v: number) => [inr(v), "Revenue"]}
                />
                <Bar dataKey="total" fill="#D4AF37" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* Table */}
      <Card className="space-y-4 p-4">
        <div className="flex flex-wrap gap-3">
          <Select value={statusF} onChange={(e) => { setPage(1); setStatusF(e.target.value as PaymentStatus | ""); }} className="w-40">
            <option value="">All statuses</option>
            <option value="paid">Paid</option>
            <option value="pending">Pending</option>
            <option value="refunded">Refunded</option>
          </Select>
          <Select value={methodF} onChange={(e) => { setPage(1); setMethodF(e.target.value as PaymentMethod | ""); }} className="w-40">
            <option value="">All methods</option>
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="card">Card</option>
            <option value="razorpay">Razorpay</option>
          </Select>
        </div>

        {loading ? (
          <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState title="No payments found" hint="Record your first payment to get started." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr className="border-b border-border">
                  <th className="px-3 py-3">Txn ID</th>
                  <th className="px-3 py-3">Member</th>
                  <th className="px-3 py-3">Amount</th>
                  <th className="px-3 py-3">Method</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.id} className="border-b border-border/60 hover:bg-surface-2/50">
                    <td className="px-3 py-3 font-mono text-xs text-muted">{p.txn_code}</td>
                    <td className="px-3 py-3 font-medium">
                      {p.member_name}
                      <span className="ml-2 font-mono text-xs text-muted">{p.member_code}</span>
                    </td>
                    <td className="px-3 py-3 font-semibold">{inr(p.amount)}</td>
                    <td className="px-3 py-3 uppercase text-muted">{p.method}</td>
                    <td className="px-3 py-3"><Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge></td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => openReceipt(p.id, p.txn_code)} title="Download receipt">
                          <Download className="h-4 w-4" />
                        </Button>
                        {p.status === "paid" && (
                          <Button variant="ghost" className="px-2.5 py-1.5 text-xs" onClick={() => onRefund(p)} title="Refund">
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.pages > 1 && (
          <div className="flex items-center justify-between pt-2 text-sm">
            <span className="text-muted">Page {data.page} of {data.pages}</span>
            <div className="flex gap-2">
              <Button variant="secondary" className="px-3 py-1.5" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button variant="secondary" className="px-3 py-1.5" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Card>

      {/* Record payment modal */}
      <Modal open={open} onClose={() => setOpen(false)} title="Record Payment">
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted">Member</label>
            <input
              value={memberQuery}
              onChange={(e) => setMemberQuery(e.target.value)}
              placeholder="Search member by name, ID or phone"
              className="mb-2 w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm text-white placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-brand/60"
            />
            <select
              value={form.member_id || ""}
              onChange={(e) => setForm((f) => ({ ...f, member_id: Number(e.target.value) }))}
              size={4}
              className="w-full rounded-xl border border-border bg-surface-2 px-2 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand/60"
            >
              {filteredMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.member_code} {m.phone ? `· ${m.phone}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Amount (₹)" type="number" value={form.amount || ""} onChange={(e) => setForm((f) => ({ ...f, amount: Number(e.target.value) }))} required />
            <Select label="Method" value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value as PaymentMethod }))}>
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="card">Card</option>
              <option value="razorpay">Razorpay</option>
            </Select>
          </div>
          <Select label="Status" value={form.status ?? "paid"} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as PaymentStatus }))}>
            <option value="paid">Paid</option>
            <option value="pending">Pending</option>
          </Select>
          <Input label="Notes (optional)" value={form.notes ?? ""} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          {formError && <p className="text-sm text-danger">{formError}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={saving}>Record Payment</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
