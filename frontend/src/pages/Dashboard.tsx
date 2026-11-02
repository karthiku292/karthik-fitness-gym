import { Users, UserCheck, CalendarX, CreditCard, TrendingUp, CalendarCheck } from "lucide-react";
import { Card } from "@/components/ui";

/**
 * Dashboard shell. KPI values are intentionally left as placeholders until
 * Phase 6 wires them to real backend aggregates (no fabricated production data).
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
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted">Business overview at a glance</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {KPIS.map(({ label, icon: Icon }) => (
          <Card key={label} className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted">{label}</p>
              <p className="mt-1 text-2xl font-bold text-muted/40">—</p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand/15 text-brand">
              <Icon className="h-5 w-5" />
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <p className="text-sm text-muted">
          Live KPIs, charts, and recent transactions connect to real backend aggregates in
          Phase 6. The foundation (auth, tenant model, settings) is wired and functional.
        </p>
      </Card>
    </div>
  );
}
