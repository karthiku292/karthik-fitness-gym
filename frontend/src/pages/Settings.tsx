import { FormEvent, useEffect, useState } from "react";
import { Button, Card, Input, Skeleton, ErrorState } from "@/components/ui";
import { api, apiErrorMessage } from "@/lib/api";

interface GymSocials {
  instagram?: string;
  facebook?: string;
  youtube?: string;
}
interface GymExtra {
  tagline?: string;
  hours?: string;
  short?: string;
  socials?: GymSocials;
}
interface GymSettings {
  name: string;
  logo_url?: string | null;
  primary_color: string;
  accent_color: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  currency: string;
  timezone: string;
  settings?: GymExtra;
}

export function SettingsPage() {
  const [data, setData] = useState<GymSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<GymSettings>("/settings");
      setData({ ...res.data, settings: res.data.settings ?? {} });
    } catch (err) {
      setError(apiErrorMessage(err, "Could not load settings"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!data) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await api.put<GymSettings>("/settings", data);
      setData({ ...res.data, settings: res.data.settings ?? {} });
      setSaved(true);
    } catch (err) {
      setError(apiErrorMessage(err, "Could not save settings"));
    } finally {
      setSaving(false);
    }
  }

  function set<K extends keyof GymSettings>(key: K, value: GymSettings[K]) {
    setData((d) => (d ? { ...d, [key]: value } : d));
  }
  function setExtra<K extends keyof GymExtra>(key: K, value: GymExtra[K]) {
    setData((d) => (d ? { ...d, settings: { ...(d.settings ?? {}), [key]: value } } : d));
  }
  function setSocial(key: keyof GymSocials, value: string) {
    setData((d) =>
      d ? { ...d, settings: { ...(d.settings ?? {}), socials: { ...(d.settings?.socials ?? {}), [key]: value } } } : d
    );
  }

  const extra = data?.settings ?? {};

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted">
          Configure your gym branding and business details. Changes apply across your whole site.
        </p>
      </div>

      {loading ? (
        <Card className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-2/3" />
        </Card>
      ) : error && !data ? (
        <Card>
          <ErrorState message={error} onRetry={load} />
        </Card>
      ) : data ? (
        <form onSubmit={onSave} className="space-y-6">
          {/* Identity */}
          <Card className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <h2 className="font-display text-lg font-semibold uppercase sm:col-span-2">Brand Identity</h2>
            <Input label="Gym Name" value={data.name} onChange={(e) => set("name", e.target.value)} />
            <Input label="Short Name (navbar)" value={extra.short ?? ""} onChange={(e) => setExtra("short", e.target.value)} placeholder="e.g. KARTHIK FITNESS" />
            <div className="sm:col-span-2">
              <Input label="Tagline" value={extra.tagline ?? ""} onChange={(e) => setExtra("tagline", e.target.value)} placeholder="BUILD YOUR STRONGER SELF" />
            </div>
            <div className="sm:col-span-2">
              <Input label="Logo URL" value={data.logo_url ?? ""} onChange={(e) => set("logo_url", e.target.value)} placeholder="https://.../logo.png" />
            </div>
            <ColorField label="Accent Color" value={data.accent_color} onChange={(v) => set("accent_color", v)} />
            <ColorField label="Primary / Background" value={data.primary_color} onChange={(v) => set("primary_color", v)} />
          </Card>

          {/* Contact */}
          <Card className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <h2 className="font-display text-lg font-semibold uppercase sm:col-span-2">Contact & Business</h2>
            <Input label="Phone" value={data.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
            <Input label="Email" value={data.email ?? ""} onChange={(e) => set("email", e.target.value)} />
            <div className="sm:col-span-2">
              <Input label="Address" value={data.address ?? ""} onChange={(e) => set("address", e.target.value)} />
            </div>
            <Input label="Opening Hours" value={extra.hours ?? ""} onChange={(e) => setExtra("hours", e.target.value)} placeholder="Mon–Sat 5AM–10PM" />
            <Input label="Currency" value={data.currency} onChange={(e) => set("currency", e.target.value)} />
            <Input label="Timezone" value={data.timezone} onChange={(e) => set("timezone", e.target.value)} />
          </Card>

          {/* Socials */}
          <Card className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <h2 className="font-display text-lg font-semibold uppercase sm:col-span-3">Social Links</h2>
            <Input label="Instagram" value={extra.socials?.instagram ?? ""} onChange={(e) => setSocial("instagram", e.target.value)} />
            <Input label="Facebook" value={extra.socials?.facebook ?? ""} onChange={(e) => setSocial("facebook", e.target.value)} />
            <Input label="YouTube" value={extra.socials?.youtube ?? ""} onChange={(e) => setSocial("youtube", e.target.value)} />
          </Card>

          <div className="flex items-center gap-3">
            <Button type="submit" loading={saving}>Save Changes</Button>
            {saved && <span className="text-sm text-success">Saved — refresh the public site to see it.</span>}
            {error && <span className="text-sm text-danger">{error}</span>}
          </div>
        </form>
      ) : null}
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-muted">{label}</label>
      <div className="flex items-center gap-3">
        <input
          type="color"
          value={value || "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-14 cursor-pointer rounded-lg border border-border bg-surface-2"
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand/60"
        />
      </div>
    </div>
  );
}
