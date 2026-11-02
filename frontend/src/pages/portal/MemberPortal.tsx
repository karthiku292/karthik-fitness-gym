import { useEffect, useState } from "react";
import { CalendarClock, CreditCard, Dumbbell, CalendarCheck, User as UserIcon } from "lucide-react";
import { Badge, Card, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { apiErrorMessage } from "@/lib/api";
import type { Member } from "@/lib/types";
import type { Payment } from "@/features/payments/api";
import {
  PortalAttendance, PortalMembership,
  getMyAttendance, getMyMembership, getMyPayments, getMyProfile,
} from "@/features/portal/api";

const inr = (n: number) => "₹" + Number(n).toLocaleString("en-IN");

export function MemberPortalPage() {
  const [profile, setProfile] = useState<Member | null>(null);
  const [membership, setMembership] = useState<PortalMembership | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [attendance, setAttendance] = useState<PortalAttendance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [p, m, pay, att] = await Promise.all([
        getMyProfile(),
        getMyMembership(),
        getMyPayments(),
        getMyAttendance(),
      ]);
      setProfile(p);
      setMembership(m);
      setPayments(pay);
      setAttendance(att);
    } catch (e) {
      setError(apiErrorMessage(e, "Could not load your details"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (error) {
    return <Card><ErrorState message={error} onRetry={load} /></Card>;
  }

  const statusTone =
    profile?.status === "active" ? "success" : profile?.status === "expired" ? "danger" : "warning";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-surface p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient text-[#080808]">
            <UserIcon className="h-7 w-7" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold uppercase">{profile?.name}</h1>
            <p className="text-sm text-muted">
              Member ID <span className="font-mono">{profile?.member_code}</span>
            </p>
          </div>
        </div>
        <Badge tone={statusTone as "success" | "danger" | "warning"}>{profile?.status}</Badge>
      </div>

      {/* Membership */}
      <Card>
        <div className="mb-4 flex items-center gap-2 text-brand">
          <Dumbbell className="h-5 w-5" />
          <h2 className="font-display text-lg font-semibold uppercase">My Membership</h2>
        </div>
        {membership ? (
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Plan" value={membership.plan_name} />
            <Field label="Start" value={membership.start_date} />
            <Field label="Expires" value={membership.end_date} />
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Days Left</p>
              <p className="mt-1">
                <Badge tone={membership.days_left <= 7 ? "danger" : membership.days_left <= 15 ? "warning" : "success"}>
                  {membership.days_left} days
                </Badge>
              </p>
            </div>
          </div>
        ) : (
          <EmptyState title="No active membership" hint="Contact the gym to activate or renew your plan." />
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Payments */}
        <Card>
          <div className="mb-4 flex items-center gap-2 text-brand">
            <CreditCard className="h-5 w-5" />
            <h2 className="font-display text-lg font-semibold uppercase">Payment History</h2>
          </div>
          {payments.length === 0 ? (
            <EmptyState title="No payments yet" />
          ) : (
            <div className="space-y-2">
              {payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-xl border border-border/60 px-4 py-3 text-sm">
                  <div>
                    <p className="font-semibold">{inr(p.amount)} <span className="font-normal uppercase text-muted">· {p.method}</span></p>
                    <p className="font-mono text-xs text-muted">{p.txn_code}</p>
                  </div>
                  <Badge tone={p.status === "paid" ? "success" : p.status === "refunded" ? "danger" : "warning"}>{p.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Attendance */}
        <Card>
          <div className="mb-4 flex items-center gap-2 text-brand">
            <CalendarCheck className="h-5 w-5" />
            <h2 className="font-display text-lg font-semibold uppercase">Attendance</h2>
          </div>
          {attendance.length === 0 ? (
            <EmptyState title="No check-ins yet" hint="Your gym visits will appear here once QR check-in is live." />
          ) : (
            <div className="space-y-2">
              {attendance.slice(0, 10).map((a, i) => (
                <div key={i} className="flex items-center justify-between rounded-xl border border-border/60 px-4 py-3 text-sm">
                  <span className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-brand" /> {a.attendance_date}</span>
                  <span className="text-muted">{new Date(a.check_in_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}
