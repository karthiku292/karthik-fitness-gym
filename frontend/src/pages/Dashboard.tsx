import { useEffect, useState } from "react";
import { Users, UserCheck, CalendarX, CreditCard, TrendingUp, CalendarCheck } from "lucide-react";
import { Card } from "@/components/ui";
import { getAttendanceToday } from "@/features/attendance/api";
import { getDashboardSummary, type DashboardSummary } from "@/features/reports/api";
import { inr } from "@/lib/currency";

/**
 * Dashboard KPI cards. The five business metrics resolve from the gym-scoped
 * `/reports/summary` endpoint; "Today's Attendance" keeps its own
 * `/attendance/today` source. Until a value resolves, a card shows the "—"
 * placeholder rather than any fabricated number.
 */
const KPIS = [
  { label: "Total Members", icon: Users, key: "total_members" },
  { label: "Active Members", icon: UserCheck, key: "active_members" },
  { label: "Expired", icon: CalendarX, key: "expired" },
  { label: "Monthly Revenue", icon: TrendingUp, key: "monthly_revenue" },
  { label: "Pending Payments", icon: CreditCard, key: "pending_payments" },
  { label: "Today's Attendance", icon: CalendarCheck, key: "attendance_today" },
];

export function DashboardPage() {
  // Two independent fetches: the business KPIs come from /reports/summary and
  // "Today's Attendance" keeps its own /attendance/today source. Each swallows
  // its own error so one failing request never blanks the other. A failed or
  // in-flight summary leaves its five cards in the "—" placeholder — no
  // fabricated value, no crash (Req 8.1–8.6).
  const [attendanceToday, setAttendanceToday] = useState<number | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const count = await getAttendanceToday();
        if (active) setAttendanceToday(count);
      } catch {
        /* leave the card in its placeholder state */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await getDashboardSummary();
        if (active) setSummary(data);
      } catch {
        /* leave the five business cards in their placeholder state */
      } finally {
        if (active) setSummaryLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Resolve a card's live value, or null when it should stay a placeholder.
  const liveValue = (key: string): string | number | null => {
    if (key === "attendance_today") return attendanceToday; // existing source (Req 8.2)
    if (!summary) return null; // placeholder while in flight or on failure (Req 8.4, 8.6)
    if (key === "monthly_revenue") return inr(summary.monthly_revenue); // INR format (Req 8.3)
    return summary[key as keyof DashboardSummary] as number;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted">Business overview at a glance</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {KPIS.map(({ label, icon: Icon, key }) => {
          const value = liveValue(key);
          const live = value !== null;
          const loading = key !== "attendance_today" && summaryLoading;
          return (
            <Card key={label} className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted">{label}</p>
                <p
                  className={`mt-1 text-2xl font-bold ${live ? "" : "text-muted/40"}`}
                  aria-busy={loading || undefined}
                >
                  {live ? value : "—"}
                </p>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand/15 text-brand">
                <Icon className="h-5 w-5" />
              </div>
            </Card>
          );
        })}
      </div>

      <Card>
        <p className="text-sm text-muted">
          The KPI cards above read live, gym-scoped figures. Trend charts arrive on the Reports
          page, with recent transactions and later surfaces to follow. The foundation (auth,
          tenant model, settings) is wired and functional.
        </p>
      </Card>
    </div>
  );
}
