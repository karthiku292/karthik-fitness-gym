import { FormEvent, useEffect, useState } from "react";
import { Plus, Check } from "lucide-react";
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
import type { MembershipPlan, PlanType } from "@/lib/types";
import { apiErrorMessage } from "@/lib/api";
import { PlanInput, createPlan, deactivatePlan, listPlans, updatePlan } from "@/features/plans/api";

const PLAN_TYPES: { value: PlanType; label: string; days: number }[] = [
  { value: "monthly", label: "Monthly", days: 30 },
  { value: "quarterly", label: "Quarterly", days: 90 },
  { value: "half_yearly", label: "Half-Yearly", days: 180 },
  { value: "yearly", label: "Yearly", days: 365 },
  { value: "custom", label: "Custom", days: 30 },
];

const EMPTY: PlanInput = { name: "", type: "monthly", duration_days: 30, price: 0, is_active: true };

export function PlansPage() {
  const [plans, setPlans] = useState<MembershipPlan[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MembershipPlan | null>(null);
  const [form, setForm] = useState<PlanInput>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setPlans(await listPlans());
    } catch (err) {
      setError(apiErrorMessage(err, "Could not load plans"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY);
    setFormError(null);
    setOpen(true);
  }

  function openEdit(p: MembershipPlan) {
    setEditing(p);
    setForm({
      name: p.name,
      type: p.type,
      duration_days: p.duration_days,
      price: p.price,
      description: p.description ?? "",
      is_active: p.is_active,
    });
    setFormError(null);
    setOpen(true);
  }

  function onTypeChange(type: PlanType) {
    const preset = PLAN_TYPES.find((t) => t.value === type);
    setForm((f) => ({ ...f, type, duration_days: type === "custom" ? f.duration_days : preset!.days }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const payload = { ...form, price: Number(form.price), duration_days: Number(form.duration_days) };
      if (editing) await updatePlan(editing.id, payload);
      else await createPlan(payload);
      setOpen(false);
      await load();
    } catch (err) {
      setFormError(apiErrorMessage(err, "Could not save plan"));
    } finally {
      setSaving(false);
    }
  }

  async function onDeactivate(p: MembershipPlan) {
    if (!confirm(`Deactivate plan "${p.name}"?`)) return;
    try {
      await deactivatePlan(p.id);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not deactivate plan"));
    }
  }

  const set = <K extends keyof PlanInput>(k: K, v: PlanInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Membership Plans</h1>
          <p className="text-sm text-muted">Create and manage the plans you offer</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" /> New Plan
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : error ? (
        <Card>
          <ErrorState message={error} onRetry={load} />
        </Card>
      ) : plans && plans.length === 0 ? (
        <Card>
          <EmptyState title="No plans yet" hint="Create your first membership plan to start assigning memberships." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans?.map((p) => (
            <Card key={p.id} className="flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold">{p.name}</h3>
                  <p className="text-xs capitalize text-muted">{p.type.replace("_", "-")}</p>
                </div>
                {p.is_active ? <Badge tone="success">Active</Badge> : <Badge tone="warning">Inactive</Badge>}
              </div>
              <div>
                <span className="text-2xl font-bold">₹{Number(p.price).toLocaleString()}</span>
                <span className="text-sm text-muted"> / {p.duration_days} days</span>
              </div>
              {p.description && <p className="text-sm text-muted">{p.description}</p>}
              {p.features?.length > 0 && (
                <ul className="space-y-1">
                  {p.features.map((f, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-muted">
                      <Check className="h-3.5 w-3.5 text-success" /> {f}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-auto flex gap-2 pt-2">
                <Button variant="secondary" className="flex-1 py-1.5 text-xs" onClick={() => openEdit(p)}>
                  Edit
                </Button>
                {p.is_active && (
                  <Button variant="ghost" className="py-1.5 text-xs" onClick={() => onDeactivate(p)}>
                    Deactivate
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit Plan" : "New Plan"}>
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input label="Plan Name" value={form.name} onChange={(e) => set("name", e.target.value)} required />
          </div>
          <Select label="Type" value={form.type} onChange={(e) => onTypeChange(e.target.value as PlanType)}>
            {PLAN_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
          <Input
            label="Duration (days)"
            type="number"
            value={form.duration_days}
            onChange={(e) => set("duration_days", Number(e.target.value))}
            disabled={form.type !== "custom"}
            required
          />
          <Input label="Price (₹)" type="number" value={form.price} onChange={(e) => set("price", Number(e.target.value))} required />
          <Select label="Status" value={form.is_active ? "1" : "0"} onChange={(e) => set("is_active", e.target.value === "1")}>
            <option value="1">Active</option>
            <option value="0">Inactive</option>
          </Select>
          <div className="sm:col-span-2">
            <Input label="Description" value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} />
          </div>
          {formError && <p className="text-sm text-danger sm:col-span-2">{formError}</p>}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {editing ? "Save Changes" : "Create Plan"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
