import { FormEvent, useEffect, useState } from "react";
import { Plus, Trash2, MapPin } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, Skeleton } from "@/components/ui";
import { apiErrorMessage } from "@/lib/api";
import { Branch, BranchInput, createBranch, deleteBranch, listBranches, updateBranch } from "@/features/branches/api";

const EMPTY: BranchInput = { name: "" };

export function BranchesPage() {
  const [rows, setRows] = useState<Branch[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [form, setForm] = useState<BranchInput>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setRows(await listBranches());
    } catch (e) {
      setError(apiErrorMessage(e, "Could not load branches"));
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
  function openEdit(b: Branch) {
    setEditing(b);
    setForm({
      name: b.name,
      address: b.address ?? "",
      city: b.city ?? "",
      phone: b.phone ?? "",
      hours: b.hours ?? "",
      photo_url: b.photo_url ?? "",
      map_url: b.map_url ?? "",
    });
    setFormError(null);
    setOpen(true);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      if (editing) await updateBranch(editing.id, form);
      else await createBranch(form);
      setOpen(false);
      await load();
    } catch (err) {
      setFormError(apiErrorMessage(err, "Could not save branch"));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(b: Branch) {
    if (!confirm(`Delete branch "${b.name}"?`)) return;
    try {
      await deleteBranch(b.id);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, "Could not delete branch"));
    }
  }

  const set = <K extends keyof BranchInput>(k: K, v: BranchInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Branches</h1>
          <p className="text-sm text-muted">Manage your gym locations shown on the website</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" /> Add Branch
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
        </div>
      ) : error ? (
        <Card><ErrorState message={error} onRetry={load} /></Card>
      ) : rows && rows.length === 0 ? (
        <Card><EmptyState title="No branches yet" hint="Add your gym's locations so members can find them." /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows?.map((b) => (
            <Card key={b.id} className="flex flex-col gap-2">
              <div className="flex items-start justify-between">
                <h3 className="font-semibold">{b.name}</h3>
                {b.is_active ? <Badge tone="success">Active</Badge> : <Badge tone="warning">Hidden</Badge>}
              </div>
              {b.city && <p className="text-sm text-brand">{b.city}</p>}
              {b.address && <p className="flex items-start gap-1.5 text-sm text-muted"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />{b.address}</p>}
              {b.phone && <p className="text-sm text-muted">{b.phone}</p>}
              {b.hours && <p className="text-xs text-muted">{b.hours}</p>}
              <div className="mt-auto flex gap-2 pt-2">
                <Button variant="secondary" className="flex-1 py-1.5 text-xs" onClick={() => openEdit(b)}>Edit</Button>
                <Button variant="ghost" className="py-1.5 text-xs" onClick={() => onDelete(b)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit Branch" : "Add Branch"}>
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input label="Branch Name" value={form.name} onChange={(e) => set("name", e.target.value)} required placeholder="e.g. Jubilee Hills" />
          </div>
          <Input label="City" value={form.city ?? ""} onChange={(e) => set("city", e.target.value)} />
          <Input label="Phone" value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
          <div className="sm:col-span-2">
            <Input label="Address" value={form.address ?? ""} onChange={(e) => set("address", e.target.value)} />
          </div>
          <Input label="Hours" value={form.hours ?? ""} onChange={(e) => set("hours", e.target.value)} placeholder="Mon–Sat 5AM–10PM" />
          <Input label="Photo URL" value={form.photo_url ?? ""} onChange={(e) => set("photo_url", e.target.value)} />
          <div className="sm:col-span-2">
            <Input label="Google Maps link" value={form.map_url ?? ""} onChange={(e) => set("map_url", e.target.value)} placeholder="https://maps.google.com/..." />
          </div>
          {formError && <p className="text-sm text-danger sm:col-span-2">{formError}</p>}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={saving}>{editing ? "Save Changes" : "Add Branch"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
