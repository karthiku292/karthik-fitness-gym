import { FormEvent, useEffect, useState } from "react";
import { Plus, UserX } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, Skeleton } from "@/components/ui";
import { apiErrorMessage } from "@/lib/api";
import { Trainer, TrainerInput, createTrainer, deactivateTrainer, listTrainers, updateTrainer } from "@/features/trainers/api";

const EMPTY: TrainerInput = { name: "" };

export function TrainersAdminPage() {
  const [rows, setRows] = useState<Trainer[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Trainer | null>(null);
  const [form, setForm] = useState<TrainerInput>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setRows(await listTrainers());
    } catch (e) {
      setError(apiErrorMessage(e, "Could not load trainers"));
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
  function openEdit(t: Trainer) {
    setEditing(t);
    setForm({
      name: t.name,
      specialization: t.specialization ?? "",
      bio: t.bio ?? "",
      photo_url: t.photo_url ?? "",
      phone: t.phone ?? "",
      email: t.email ?? "",
      hourly_rate: t.hourly_rate ?? undefined,
    });
    setFormError(null);
    setOpen(true);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const payload = { ...form, hourly_rate: form.hourly_rate ? Number(form.hourly_rate) : undefined };
      if (editing) await updateTrainer(editing.id, payload);
      else await createTrainer(payload);
      setOpen(false);
      await load();
    } catch (err) {
      setFormError(apiErrorMessage(err, "Could not save trainer"));
    } finally {
      setSaving(false);
    }
  }

  async function onDeactivate(t: Trainer) {
    if (!confirm(`Deactivate ${t.name}?`)) return;
    try {
      await deactivateTrainer(t.id);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, "Could not deactivate trainer"));
    }
  }

  const set = <K extends keyof TrainerInput>(k: K, v: TrainerInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Trainers</h1>
          <p className="text-sm text-muted">Manage the coaches shown on your website</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" /> Add Trainer
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-56 w-full" />)}
        </div>
      ) : error ? (
        <Card><ErrorState message={error} onRetry={load} /></Card>
      ) : rows && rows.length === 0 ? (
        <Card><EmptyState title="No trainers yet" hint="Add your coaches so they appear on the public Trainers page." /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows?.map((t) => (
            <Card key={t.id} className="flex flex-col gap-2">
              <div className="flex items-start gap-3">
                {t.photo_url ? (
                  <img src={t.photo_url} alt={t.name} className="h-14 w-14 rounded-xl object-cover" />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-surface-2 text-lg font-bold text-brand">
                    {t.name.charAt(0)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="truncate font-semibold">{t.name}</h3>
                    {t.is_active ? <Badge tone="success">Active</Badge> : <Badge tone="warning">Hidden</Badge>}
                  </div>
                  <p className="truncate text-sm text-brand">{t.specialization}</p>
                </div>
              </div>
              {t.bio && <p className="line-clamp-2 text-sm text-muted">{t.bio}</p>}
              <div className="mt-auto flex gap-2 pt-2">
                <Button variant="secondary" className="flex-1 py-1.5 text-xs" onClick={() => openEdit(t)}>Edit</Button>
                {t.is_active && (
                  <Button variant="ghost" className="py-1.5 text-xs" onClick={() => onDeactivate(t)}><UserX className="h-4 w-4" /></Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit Trainer" : "Add Trainer"}>
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input label="Name" value={form.name} onChange={(e) => set("name", e.target.value)} required />
          </div>
          <Input label="Specialization" value={form.specialization ?? ""} onChange={(e) => set("specialization", e.target.value)} placeholder="e.g. Strength & Conditioning" />
          <Input label="Photo URL" value={form.photo_url ?? ""} onChange={(e) => set("photo_url", e.target.value)} />
          <Input label="Phone" value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
          <Input label="Email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} />
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-muted">Bio</label>
            <textarea
              value={form.bio ?? ""}
              onChange={(e) => set("bio", e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand/60"
              placeholder="Short description shown on the website"
            />
          </div>
          {formError && <p className="text-sm text-danger sm:col-span-2">{formError}</p>}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={saving}>{editing ? "Save Changes" : "Add Trainer"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
