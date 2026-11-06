import { FormEvent, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, UserPlus } from "lucide-react";
import { Button, Card, EmptyState, ErrorState, Input, Modal, Skeleton } from "@/components/ui";
import { apiErrorMessage } from "@/lib/api";
import type { Member } from "@/lib/types";
import { listMembers } from "@/features/members/api";
import { Plan, PlanInput, PlanKind, assignPlan, createPlan, deletePlan, listPlans, updatePlan } from "@/features/fitness/api";

const EMPTY: PlanInput = { name: "", description: "", details: "" };

/** Reusable manager for workout or diet plans (admin creates + assigns). */
export function PlanManager({ kind, title, subtitle }: { kind: PlanKind; title: string; subtitle: string }) {
  const [rows, setRows] = useState<Plan[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [form, setForm] = useState<PlanInput>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Assign modal
  const [assignFor, setAssignFor] = useState<Plan | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [memberQuery, setMemberQuery] = useState("");
  const [assignId, setAssignId] = useState<number>(0);
  const [assigning, setAssigning] = useState(false);
  const [assignMsg, setAssignMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setRows(await listPlans(kind));
    } catch (e) {
      setError(apiErrorMessage(e, "Could not load plans"));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY);
    setFormError(null);
    setOpen(true);
  }
  function openEdit(p: Plan) {
    setEditing(p);
    setForm({ name: p.name, description: p.description ?? "", details: p.details ?? "" });
    setFormError(null);
    setOpen(true);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      if (editing) await updatePlan(kind, editing.id, form);
      else await createPlan(kind, form);
      setOpen(false);
      await load();
    } catch (err) {
      setFormError(apiErrorMessage(err, "Could not save plan"));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(p: Plan) {
    if (!confirm(`Delete "${p.name}"? This unassigns it from members.`)) return;
    try {
      await deletePlan(kind, p.id);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, "Could not delete plan"));
    }
  }

  async function openAssign(p: Plan) {
    setAssignFor(p);
    setAssignId(0);
    setMemberQuery("");
    setAssignMsg(null);
    try {
      const res = await listMembers({ page: 1, page_size: 100 });
      setMembers(res.items);
    } catch {
      /* ignore */
    }
  }
  async function doAssign() {
    if (!assignFor || !assignId) return;
    setAssigning(true);
    setAssignMsg(null);
    try {
      await assignPlan(kind, assignFor.id, assignId);
      setAssignMsg("Assigned — the member sees it in their portal.");
    } catch (e) {
      setAssignMsg(apiErrorMessage(e, "Could not assign"));
    } finally {
      setAssigning(false);
    }
  }

  const filteredMembers = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => m.name.toLowerCase().includes(q) || m.member_code.toLowerCase().includes(q));
  }, [members, memberQuery]);

  const set = <K extends keyof PlanInput>(k: K, v: PlanInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="text-sm text-muted">{subtitle}</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" /> New Plan
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
        </div>
      ) : error ? (
        <Card><ErrorState message={error} onRetry={load} /></Card>
      ) : rows && rows.length === 0 ? (
        <Card><EmptyState title="No plans yet" hint="Create a plan, then assign it to members." /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows?.map((p) => (
            <Card key={p.id} className="flex flex-col gap-2">
              <h3 className="font-semibold">{p.name}</h3>
              {p.description && <p className="text-sm text-muted">{p.description}</p>}
              {p.details && <p className="line-clamp-3 whitespace-pre-wrap text-xs text-muted/80">{p.details}</p>}
              <div className="mt-auto flex gap-2 pt-2">
                <Button variant="secondary" className="flex-1 py-1.5 text-xs" onClick={() => openEdit(p)}>Edit</Button>
                <Button variant="secondary" className="py-1.5 text-xs" onClick={() => openAssign(p)} title="Assign to member"><UserPlus className="h-4 w-4" /></Button>
                <Button variant="ghost" className="py-1.5 text-xs" onClick={() => onDelete(p)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create / edit */}
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit Plan" : "New Plan"}>
        <form onSubmit={onSubmit} className="space-y-4">
          <Input label="Plan Name" value={form.name} onChange={(e) => set("name", e.target.value)} required />
          <Input label="Short summary" value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} placeholder="e.g. 4-day upper/lower split" />
          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted">Full plan details</label>
            <textarea
              value={form.details ?? ""}
              onChange={(e) => set("details", e.target.value)}
              rows={8}
              className="w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand/60"
              placeholder={kind === "workout" ? "Day 1 - Chest:\n  Bench Press 4x8\n  Incline DB Press 3x10\n..." : "Breakfast: 4 eggs, oats...\nLunch: ...\nDinner: ..."}
            />
          </div>
          {formError && <p className="text-sm text-danger">{formError}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={saving}>{editing ? "Save Changes" : "Create Plan"}</Button>
          </div>
        </form>
      </Modal>

      {/* Assign */}
      <Modal open={!!assignFor} onClose={() => setAssignFor(null)} title={`Assign "${assignFor?.name ?? ""}"`}>
        <div className="space-y-4">
          <input
            value={memberQuery}
            onChange={(e) => setMemberQuery(e.target.value)}
            placeholder="Search member by name or ID"
            className="w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm text-white placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-brand/60"
          />
          <select
            value={assignId || ""}
            onChange={(e) => setAssignId(Number(e.target.value))}
            size={5}
            className="w-full rounded-xl border border-border bg-surface-2 px-2 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand/60"
          >
            {filteredMembers.map((m) => (
              <option key={m.id} value={m.id}>{m.name} · {m.member_code}</option>
            ))}
          </select>
          {assignMsg && <p className="text-sm text-success">{assignMsg}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setAssignFor(null)}>Close</Button>
            <Button onClick={doAssign} loading={assigning} disabled={!assignId}>Assign</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
