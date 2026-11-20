import { useEffect, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import type { Page } from "@/lib/types";
import { apiErrorMessage } from "@/lib/api";
import { AttendanceMethod, AttendanceRow, listAttendance } from "@/features/attendance/api";

const METHOD_TONE: Record<AttendanceMethod, "brand" | "neutral"> = {
  qr: "brand",
  manual: "neutral",
};

export function AttendanceHistoryPage() {
  const [data, setData] = useState<Page<AttendanceRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [date, setDate] = useState("");
  const [page, setPage] = useState(1);

  const pageSize = 10;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await listAttendance({
        date: date || undefined,
        page,
        page_size: pageSize,
      });
      setData(res);
    } catch (err) {
      setError(apiErrorMessage(err, "Could not load attendance history"));
    } finally {
      setLoading(false);
    }
  }

  // Reload on date filter / page change.
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, page]);

  const totalPages = data?.pages ?? 1;
  const rows = useMemo(() => data?.items ?? [], [data]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Attendance History</h1>
          <p className="text-sm text-muted">{data?.total ?? 0} total check-ins</p>
        </div>
      </div>

      <Card className="space-y-4 p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative">
            <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setPage(1);
                setDate(e.target.value);
              }}
              className="rounded-xl border border-border bg-surface-2 px-9 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand/60"
            />
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No check-ins found"
            hint="Try a different date, or check members in from the Scanner."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr className="border-b border-border">
                  <th className="px-3 py-3">Member</th>
                  <th className="px-3 py-3">Code</th>
                  <th className="px-3 py-3">Date</th>
                  <th className="px-3 py-3">Check-in</th>
                  <th className="px-3 py-3">Method</th>
                  <th className="px-3 py-3">Verifier</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="border-b border-border/60 hover:bg-surface-2/50">
                    <td className="px-3 py-3 font-medium">{a.member_name}</td>
                    <td className="px-3 py-3 font-mono text-xs text-muted">{a.member_code}</td>
                    <td className="px-3 py-3 text-muted">{a.attendance_date}</td>
                    <td className="px-3 py-3 text-muted">
                      {new Date(a.check_in_at).toLocaleTimeString()}
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={METHOD_TONE[a.method]}>{a.method}</Badge>
                    </td>
                    <td className="px-3 py-3 text-muted">
                      {a.verified_by != null ? `#${a.verified_by}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && totalPages > 1 && (
          <div className="flex items-center justify-between pt-2 text-sm">
            <span className="text-muted">
              Page {data.page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="px-3 py-1.5"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                className="px-3 py-1.5"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
