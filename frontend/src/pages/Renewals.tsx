import { useEffect, useState } from "react";
import { Badge, Button, Card, EmptyState, ErrorState, Select, Skeleton } from "@/components/ui";
import type { Member, Membership } from "@/lib/types";
import { api, apiErrorMessage } from "@/lib/api";
import { listMembers } from "@/features/members/api";

async function fetchUpcoming(days: number): Promise<Membership[]> {
  const { data } = await api.get<Membership[]>("/memberships/upcoming-renewals", { params: { days } });
  return data;
}

export function RenewalsPage() {
  const [days, setDays] = useState(7);
  const [rows, setRows] = useState<Membership[] | null>(null);
  const [members, setMembers] = useState<Record<number, Member>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renewingId, setRenewingId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [upcoming, memberPage] = await Promise.all([
        fetchUpcoming(days),
        listMembers({ page: 1, page_size: 100 }),
      ]);
      setRows(upcoming);
      const map: Record<number, Member> = {};
      memberPage.items.forEach((m) => (map[m.id] = m));
      setMembers(map);
    } catch (err) {
      setError(apiErrorMessage(err, "Could not load renewals"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  async function renew(m: Membership) {
    if (!confirm("Renew this membership using the current plan?")) return;
    setRenewingId(m.id);
    try {
      await api.post(`/memberships/${m.id}/renew`, {});
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not renew membership"));
    } finally {
      setRenewingId(null);
    }
  }

  function daysLeft(end: string): number {
    const diff = new Date(end).getTime() - Date.now();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Renewals</h1>
          <p className="text-sm text-muted">Memberships expiring soon</p>
        </div>
        <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-40">
          <option value={7}>Next 7 days</option>
          <option value={15}>Next 15 days</option>
          <option value={30}>Next 30 days</option>
        </Select>
      </div>

      <Card>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !rows || rows.length === 0 ? (
          <EmptyState title="No upcoming renewals" hint={`No memberships expire in the next ${days} days.`} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr className="border-b border-border">
                  <th className="px-3 py-3">Member</th>
                  <th className="px-3 py-3">Expires</th>
                  <th className="px-3 py-3">Days Left</th>
                  <th className="px-3 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const left = daysLeft(m.end_date);
                  return (
                    <tr key={m.id} className="border-b border-border/60 hover:bg-surface-2/50">
                      <td className="px-3 py-3 font-medium">
                        {members[m.member_id]?.name ?? `Member #${m.member_id}`}
                        <span className="ml-2 font-mono text-xs text-muted">
                          {members[m.member_id]?.member_code ?? ""}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-muted">{m.end_date}</td>
                      <td className="px-3 py-3">
                        <Badge tone={left <= 3 ? "danger" : "warning"}>{left} days</Badge>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Button className="px-3 py-1.5 text-xs" loading={renewingId === m.id} onClick={() => renew(m)}>
                          Renew
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
