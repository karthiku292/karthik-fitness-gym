import { FormEvent, useEffect, useMemo, useState } from "react";
import { Plus, Search, UserX, KeyRound } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  Select,
  Skeleton,
} from "@/components/ui";
import type { Member, MemberStatus, Page } from "@/lib/types";
import { apiErrorMessage } from "@/lib/api";
import {
  MemberInput,
  createMember,
  deactivateMember,
  listMembers,
  setMemberCredentials,
  updateMember,
} from "@/features/members/api";

const STATUS_TONE: Record<MemberStatus, "success" | "warning" | "danger"> = {
  active: "success",
  inactive: "warning",
  expired: "danger",
};

const EMPTY_FORM: MemberInput = { name: "", phone: "", email: "" };

export function MembersPage() {
  const [data, setData] = useState<Page<Member> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<MemberStatus | "">("");
  const [page, setPage] = useState(1);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [form, setForm] = useState<MemberInput>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Portal-access (member login) modal
  const [credMember, setCredMember] = useState<Member | null>(null);
  const [credPhone, setCredPhone] = useState("");
  const [credPassword, setCredPassword] = useState("");
  const [credSaving, setCredSaving] = useState(false);
  const [credError, setCredError] = useState<string | null>(null);
  const [credDone, setCredDone] = useState(false);

  const pageSize = 10;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await listMembers({
        search: search || undefined,
        status: status || undefined,
        page,
        page_size: pageSize,
      });
      setData(res);
    } catch (err) {
      setError(apiErrorMessage(err, "Could not load members"));
    } finally {
      setLoading(false);
    }
  }

  // Reload on filter/page change (debounced for search).
  useEffect(() => {
    const t = setTimeout(load, search ? 350 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status, page]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(m: Member) {
    setEditing(m);
    setForm({
      name: m.name,
      phone: m.phone ?? "",
      email: m.email ?? "",
      age: m.age ?? undefined,
      gender: m.gender ?? "",
      address: m.address ?? "",
      emergency_contact: m.emergency_contact ?? "",
    });
    setFormError(null);
    setModalOpen(true);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const payload: MemberInput = {
        ...form,
        age: form.age ? Number(form.age) : undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
      };
      if (editing) {
        await updateMember(editing.id, payload);
      } else {
        await createMember(payload);
      }
      setModalOpen(false);
      setPage(1);
      await load();
    } catch (err) {
      setFormError(apiErrorMessage(err, "Could not save member"));
    } finally {
      setSaving(false);
    }
  }

  async function onDeactivate(m: Member) {
    if (!confirm(`Deactivate ${m.name}?`)) return;
    try {
      await deactivateMember(m.id);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not deactivate member"));
    }
  }

  function openAccess(m: Member) {
    setCredMember(m);
    setCredPhone(m.phone ?? "");
    setCredPassword("");
    setCredError(null);
    setCredDone(false);
  }

  async function onSaveCredentials(e: FormEvent) {
    e.preventDefault();
    if (!credMember) return;
    setCredSaving(true);
    setCredError(null);
    try {
      await setMemberCredentials(credMember.id, credPhone, credPassword);
      setCredDone(true);
      await load();
    } catch (err) {
      setCredError(apiErrorMessage(err, "Could not set login"));
    } finally {
      setCredSaving(false);
    }
  }

  const totalPages = data?.pages ?? 1;
  const set = <K extends keyof MemberInput>(k: K, v: MemberInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const rows = useMemo(() => data?.items ?? [], [data]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Members</h1>
          <p className="text-sm text-muted">{data?.total ?? 0} total members</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" /> Add Member
        </Button>
      </div>

      <Card className="space-y-4 p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={search}
              onChange={(e) => {
                setPage(1);
                setSearch(e.target.value);
              }}
              placeholder="Search by name, ID, phone, or email"
              className="w-full rounded-xl border border-border bg-surface-2 px-9 py-2.5 text-sm text-white placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-brand/60"
            />
          </div>
          <Select
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value as MemberStatus | "");
            }}
            className="w-44"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="expired">Expired</option>
          </Select>
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
          <EmptyState title="No members found" hint="Try adjusting filters or add a new member." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr className="border-b border-border">
                  <th className="px-3 py-3">Code</th>
                  <th className="px-3 py-3">Name</th>
                  <th className="px-3 py-3">Phone</th>
                  <th className="px-3 py-3">Joined</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className="border-b border-border/60 hover:bg-surface-2/50">
                    <td className="px-3 py-3 font-mono text-xs text-muted">{m.member_code}</td>
                    <td className="px-3 py-3 font-medium">{m.name}</td>
                    <td className="px-3 py-3 text-muted">{m.phone || "—"}</td>
                    <td className="px-3 py-3 text-muted">{m.joining_date}</td>
                    <td className="px-3 py-3">
                      <Badge tone={STATUS_TONE[m.status]}>{m.status}</Badge>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => openEdit(m)}>
                          Edit
                        </Button>
                        <Button
                          variant="secondary"
                          className="px-2 py-1.5 text-xs"
                          onClick={() => openAccess(m)}
                          title={m.user_id ? "Reset portal login" : "Grant portal access"}
                        >
                          <KeyRound className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          className="px-2 py-1.5 text-xs"
                          onClick={() => onDeactivate(m)}
                          title="Deactivate"
                        >
                          <UserX className="h-4 w-4" />
                        </Button>
                      </div>
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
              <Button variant="secondary" className="px-3 py-1.5" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button variant="secondary" className="px-3 py-1.5" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Edit Member" : "Add Member"}>
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input label="Full Name" value={form.name} onChange={(e) => set("name", e.target.value)} required />
          </div>
          <Input label="Phone" value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
          <Input label="Email" type="email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} />
          <Input label="Age" type="number" value={form.age ?? ""} onChange={(e) => set("age", e.target.value ? Number(e.target.value) : undefined)} />
          <Select label="Gender" value={form.gender ?? ""} onChange={(e) => set("gender", e.target.value)}>
            <option value="">—</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </Select>
          <div className="sm:col-span-2">
            <Input label="Address" value={form.address ?? ""} onChange={(e) => set("address", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Input label="Emergency Contact" value={form.emergency_contact ?? ""} onChange={(e) => set("emergency_contact", e.target.value)} />
          </div>
          {formError && <p className="text-sm text-danger sm:col-span-2">{formError}</p>}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {editing ? "Save Changes" : "Create Member"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Grant / reset member portal login */}
      <Modal
        open={!!credMember}
        onClose={() => setCredMember(null)}
        title={credMember?.user_id ? "Reset Portal Login" : "Grant Portal Access"}
      >
        {credDone ? (
          <div className="space-y-4">
            <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
              Login saved for {credMember?.name}. They sign in at the login page with their phone number and this password.
            </p>
            <div className="flex justify-end">
              <Button onClick={() => setCredMember(null)}>Done</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSaveCredentials} className="space-y-4">
            <p className="text-sm text-muted">
              Set a login for <span className="font-medium text-white">{credMember?.name}</span>. They'll sign in with
              their <span className="font-medium text-white">phone number</span> at the normal login page and land on
              their member portal (not the admin area).
            </p>
            <Input
              label="Login phone number"
              type="tel"
              value={credPhone}
              onChange={(e) => setCredPhone(e.target.value)}
              required
              placeholder="e.g. 9876543210"
            />
            <Input
              label="Password (min 8 chars)"
              type="text"
              value={credPassword}
              onChange={(e) => setCredPassword(e.target.value)}
              required
              minLength={8}
              placeholder="Share this with the member"
            />
            {credError && <p className="text-sm text-danger">{credError}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setCredMember(null)}>Cancel</Button>
              <Button type="submit" loading={credSaving}>Save Login</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
