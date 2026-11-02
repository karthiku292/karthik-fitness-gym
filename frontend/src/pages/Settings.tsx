import { FormEvent, useEffect, useState } from "react";
import { Button, Card, Input, Skeleton, ErrorState } from "@/components/ui";
import { api, apiErrorMessage } from "@/lib/api";

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
      setData(res.data);
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
      setData(res.data);
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted">Configure your gym branding and business details</p>
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
        <Card>
          <form onSubmit={onSave} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Gym Name" value={data.name} onChange={(e) => set("name", e.target.value)} />
            <Input label="Logo URL" value={data.logo_url ?? ""} onChange={(e) => set("logo_url", e.target.value)} />
            <Input label="Primary Color" value={data.primary_color} onChange={(e) => set("primary_color", e.target.value)} />
            <Input label="Accent Color" value={data.accent_color} onChange={(e) => set("accent_color", e.target.value)} />
            <Input label="Phone" value={data.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
            <Input label="Email" value={data.email ?? ""} onChange={(e) => set("email", e.target.value)} />
            <Input label="Currency" value={data.currency} onChange={(e) => set("currency", e.target.value)} />
            <Input label="Timezone" value={data.timezone} onChange={(e) => set("timezone", e.target.value)} />
            <div className="sm:col-span-2">
              <Input label="Address" value={data.address ?? ""} onChange={(e) => set("address", e.target.value)} />
            </div>
            <div className="flex items-center gap-3 sm:col-span-2">
              <Button type="submit" loading={saving}>Save Changes</Button>
              {saved && <span className="text-sm text-success">Saved</span>}
              {error && <span className="text-sm text-danger">{error}</span>}
            </div>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
