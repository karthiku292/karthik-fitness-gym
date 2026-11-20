import { CSSProperties, ReactElement, useCallback, useEffect, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Card, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { apiErrorMessage } from "@/lib/api";
import { inr } from "@/lib/currency";
import {
  DailyAttendancePoint, MonthlyRevenuePoint, MonthlySignupPoint, PlanRevenuePoint,
  getAttendanceTrend, getRevenueByPlan, getRevenueTrend, getSignupTrend,
} from "@/features/reports/api";

// Dark Recharts styling tokens, reused from the Payments page (Req 9.3).
const GRID = "#2A2A2A";
const AXIS = "#9A9A9A";
const ACCENT = "#B794F6";
const TOOLTIP_STYLE: CSSProperties = {
  background: "#151515",
  border: "1px solid #2A2A2A",
  borderRadius: 12,
  color: "#fff",
};

/**
 * Minimal async hook: one independent request per chart so a single failure
 * stays isolated to its own card (Req 9.2). `fetcher` must be a stable
 * reference (module-level API functions) to avoid a reload loop.
 */
function useAsync<T>(fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetcher()
      .then(setData)
      .catch((e) => setError(apiErrorMessage(e, "Could not load chart")))
      .finally(() => setLoading(false));
  }, [fetcher]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}

/**
 * Wraps one chart with its own data lifecycle, rendering (in priority order)
 * a loading skeleton (Req 9.4), an error state with retry (Req 9.5), an empty
 * state for an empty dataset (Req 9.6), or otherwise the chart itself.
 */
function ChartCard<T>({
  title,
  subtitle,
  fetcher,
  emptyTitle,
  emptyHint,
  children,
}: {
  title: string;
  subtitle: string;
  fetcher: () => Promise<T[]>;
  emptyTitle: string;
  emptyHint: string;
  children: (data: T[]) => ReactElement;
}) {
  const { data, loading, error, reload } = useAsync(fetcher);

  return (
    <Card>
      <div className="mb-4">
        <h2 className="font-display text-lg font-semibold uppercase">{title}</h2>
        <p className="text-sm text-muted">{subtitle}</p>
      </div>
      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.length === 0 ? (
        <EmptyState title={emptyTitle} hint={emptyHint} />
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            {children(data)}
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

export function ReportsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Reports &amp; Analytics</h1>
        <p className="text-sm text-muted">Revenue, growth and attendance trends for your gym</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 1. Monthly revenue trend (12 months) */}
        <ChartCard<MonthlyRevenuePoint>
          title="Monthly Revenue"
          subtitle="Paid revenue over the last 12 months"
          fetcher={getRevenueTrend}
          emptyTitle="No revenue yet"
          emptyHint="Paid payments will appear here once recorded."
        >
          {(data) => (
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="month" stroke={AXIS} fontSize={12} tickFormatter={(v) => v.slice(5)} />
              <YAxis stroke={AXIS} fontSize={12} tickFormatter={(v) => `₹${v / 1000}k`} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [inr(v), "Revenue"]} />
              <Line type="monotone" dataKey="revenue" stroke={ACCENT} strokeWidth={2} dot={false} />
            </LineChart>
          )}
        </ChartCard>

        {/* 2. New member sign-up trend (12 months) */}
        <ChartCard<MonthlySignupPoint>
          title="New Sign-ups"
          subtitle="New members over the last 12 months"
          fetcher={getSignupTrend}
          emptyTitle="No sign-ups yet"
          emptyHint="New member sign-ups will appear here."
        >
          {(data) => (
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="month" stroke={AXIS} fontSize={12} tickFormatter={(v) => v.slice(5)} />
              <YAxis stroke={AXIS} fontSize={12} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [v, "Sign-ups"]} />
              <Bar dataKey="signups" fill={ACCENT} radius={[6, 6, 0, 0]} />
            </BarChart>
          )}
        </ChartCard>

        {/* 3. Daily attendance trend (30 days) */}
        <ChartCard<DailyAttendancePoint>
          title="Daily Attendance"
          subtitle="Check-ins over the last 30 days"
          fetcher={getAttendanceTrend}
          emptyTitle="No attendance yet"
          emptyHint="Member check-ins will appear here."
        >
          {(data) => (
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="date" stroke={AXIS} fontSize={12} interval={4} tickFormatter={(v) => v.slice(5)} />
              <YAxis stroke={AXIS} fontSize={12} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [v, "Check-ins"]} />
              <Area type="monotone" dataKey="count" stroke={ACCENT} strokeWidth={2} fill={ACCENT} fillOpacity={0.2} />
            </AreaChart>
          )}
        </ChartCard>

        {/* 4. Revenue by plan (current month) */}
        <ChartCard<PlanRevenuePoint>
          title="Revenue by Plan"
          subtitle="Current month revenue grouped by plan"
          fetcher={getRevenueByPlan}
          emptyTitle="No revenue this month"
          emptyHint="Revenue by plan for the current month will appear here."
        >
          {(data) => (
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="plan" stroke={AXIS} fontSize={12} />
              <YAxis stroke={AXIS} fontSize={12} tickFormatter={(v) => `₹${v / 1000}k`} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [inr(v), "Revenue"]} />
              <Bar dataKey="revenue" fill={ACCENT} radius={[6, 6, 0, 0]} />
            </BarChart>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
