import { FormEvent, useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import {
  BellRing,
  CheckCircle2,
  FileText,
  History,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Search,
  Send,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
import type { Page } from "@/lib/types";
import { apiErrorMessage } from "@/lib/api";
import {
  createTemplate,
  deleteTemplate,
  listNotifications,
  listTemplates,
  runReminders,
  searchMembers,
  sendNotification,
  updateTemplate,
} from "@/features/notifications/api";
import type {
  Channel,
  EventType,
  ManualSend,
  MemberLookup,
  NotificationLog,
  NotificationStatus,
  NotificationTemplate,
  ReminderRunResult,
  TemplateInput,
} from "@/features/notifications/api";

/* ---------------- Shared tokens ---------------- */

const STATUS_TONE: Record<NotificationStatus, "success" | "danger" | "neutral"> = {
  sent: "success",
  failed: "danger",
  queued: "neutral",
};

const CHANNEL_TONE: Record<Channel, "brand" | "neutral"> = {
  whatsapp: "brand",
  email: "neutral",
};

const EVENT_TYPES: EventType[] = ["welcome", "membership_expiry", "payment_receipt"];
const CHANNELS: Channel[] = ["whatsapp", "email"];
const STATUSES: NotificationStatus[] = ["queued", "sent", "failed"];

const EVENT_LABEL: Record<EventType, string> = {
  welcome: "Welcome",
  membership_expiry: "Membership expiry",
  payment_receipt: "Payment receipt",
};

/** Human label for an event type that the log stores as a free string. */
function eventLabel(ev: string): string {
  return EVENT_LABEL[ev as EventType] ?? ev;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/* ---------------- Member typeahead (reused by log filter + manual send) ---------------- */

function MemberSearch({
  selected,
  onSelect,
  onClear,
  placeholder,
}: {
  selected: MemberLookup | null;
  onSelect: (m: MemberLookup) => void;
  onClear: () => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberLookup[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Debounced member search (mirrors the Scanner member-search pattern).
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearchError(null);
      setSearching(false);
      return;
    }
    let active = true;
    setSearching(true);
    setSearchError(null);
    const timer = setTimeout(async () => {
      try {
        const r = await searchMembers(q);
        if (active) setResults(r);
      } catch (e) {
        if (active) {
          setResults([]);
          setSearchError(apiErrorMessage(e, "Could not search members"));
        }
      } finally {
        if (active) setSearching(false);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-2 px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{selected.name}</p>
          <p className="font-mono text-xs text-muted">
            {selected.member_code}
            {selected.phone ? ` · ${selected.phone}` : ""}
          </p>
        </div>
        <Button type="button" variant="ghost" className="px-2 py-1 text-xs" onClick={onClear}>
          Change
        </Button>
      </div>
    );
  }

  const q = query.trim();
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder ?? "Search by name, code, phone, or email"}
          className="w-full rounded-xl border border-border bg-surface-2 px-9 py-2.5 text-sm text-white placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-brand/60"
        />
      </div>
      {searchError ? (
        <p className="text-sm text-danger">{searchError}</p>
      ) : searching ? (
        <p className="text-sm text-muted">Searching…</p>
      ) : q && results.length === 0 ? (
        <p className="text-sm text-muted">No members match “{q}”.</p>
      ) : results.length > 0 ? (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
          {results.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => {
                  onSelect(m);
                  setQuery("");
                  setResults([]);
                }}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-2/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{m.name}</p>
                  <p className="font-mono text-xs text-muted">
                    {m.member_code}
                    {m.phone ? ` · ${m.phone}` : ""}
                  </p>
                </div>
                <Badge tone={m.status === "active" ? "success" : "neutral"}>{m.status}</Badge>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ---------------- Tab 1: notification log ---------------- */

function LogTab() {
  const [data, setData] = useState<Page<NotificationLog> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState<NotificationStatus | "">("");
  const [channel, setChannel] = useState<Channel | "">("");
  const [eventType, setEventType] = useState<EventType | "">("");
  const [member, setMember] = useState<MemberLookup | null>(null);
  const [page, setPage] = useState(1);

  const pageSize = 20;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await listNotifications({
        status: status || undefined,
        channel: channel || undefined,
        event_type: eventType || undefined,
        member_id: member?.id,
        page,
        page_size: pageSize,
      });
      setData(res);
    } catch (err) {
      setError(apiErrorMessage(err, "Could not load notifications"));
    } finally {
      setLoading(false);
    }
  }

  // Reload whenever a filter or the page changes; filter changes reset to page 1.
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, channel, eventType, member, page]);

  const totalPages = data?.pages ?? 1;
  const rows = useMemo(() => data?.items ?? [], [data]);

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <Select
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value as NotificationStatus | "");
          }}
          className="w-40"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select
          value={channel}
          onChange={(e) => {
            setPage(1);
            setChannel(e.target.value as Channel | "");
          }}
          className="w-40"
        >
          <option value="">All channels</option>
          {CHANNELS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Select
          value={eventType}
          onChange={(e) => {
            setPage(1);
            setEventType(e.target.value as EventType | "");
          }}
          className="w-48"
        >
          <option value="">All events</option>
          {EVENT_TYPES.map((ev) => (
            <option key={ev} value={ev}>
              {EVENT_LABEL[ev]}
            </option>
          ))}
        </Select>
        <div className="min-w-[240px] flex-1">
          <MemberSearch
            selected={member}
            onSelect={(m) => {
              setPage(1);
              setMember(m);
            }}
            onClear={() => {
              setPage(1);
              setMember(null);
            }}
            placeholder="Filter by member"
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
          title="No notifications found"
          hint="Try different filters, send a message, or run expiry reminders."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted">
              <tr className="border-b border-border">
                <th className="px-3 py-3">Time</th>
                <th className="px-3 py-3">Member</th>
                <th className="px-3 py-3">Event</th>
                <th className="px-3 py-3">Channel</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((n) => (
                <tr key={n.id} className="border-b border-border/60 hover:bg-surface-2/50">
                  <td className="px-3 py-3 text-muted">
                    <div>{fmtDateTime(n.created_at)}</div>
                    {n.sent_at && (
                      <div className="text-xs text-muted/70">sent {fmtDateTime(n.sent_at)}</div>
                    )}
                  </td>
                  <td className="px-3 py-3 font-medium">{n.member_name ?? "—"}</td>
                  <td className="px-3 py-3 text-muted">{eventLabel(n.event_type)}</td>
                  <td className="px-3 py-3">
                    <Badge tone={CHANNEL_TONE[n.channel]}>{n.channel}</Badge>
                  </td>
                  <td className="px-3 py-3">
                    <Badge tone={STATUS_TONE[n.status]}>{n.status}</Badge>
                  </td>
                  <td className="px-3 py-3">
                    {n.status === "failed" && n.error ? (
                      <span className="text-xs text-danger">{n.error}</span>
                    ) : n.provider_ref ? (
                      <span className="font-mono text-xs text-muted">{n.provider_ref}</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
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
            Page {data.page} of {totalPages} · {data.total} total
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
  );
}

/* ---------------- Tab 2: template management ---------------- */

const EMPTY_TEMPLATE: TemplateInput = {
  event_type: "welcome",
  channel: "whatsapp",
  subject: "",
  body: "",
};

function TemplatesTab() {
  const [templates, setTemplates] = useState<NotificationTemplate[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<NotificationTemplate | null>(null);
  const [form, setForm] = useState<TemplateInput>(EMPTY_TEMPLATE);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setTemplates(await listTemplates());
    } catch (err) {
      setError(apiErrorMessage(err, "Could not load templates"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_TEMPLATE);
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(t: NotificationTemplate) {
    setEditing(t);
    setForm({
      event_type: t.event_type,
      channel: t.channel,
      subject: t.subject ?? "",
      body: t.body,
    });
    setFormError(null);
    setModalOpen(true);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const payload: TemplateInput = {
        event_type: form.event_type,
        channel: form.channel,
        subject: form.subject ? form.subject : null,
        body: form.body,
      };
      if (editing) {
        await updateTemplate(editing.id, payload);
      } else {
        await createTemplate(payload);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      // Keep the modal open with the admin's input intact on failure.
      setFormError(apiErrorMessage(err, "Could not save template"));
    } finally {
      setSaving(false);
    }
  }

  async function onToggle(t: NotificationTemplate) {
    setBusyId(t.id);
    setError(null);
    try {
      await updateTemplate(t.id, { is_active: !t.is_active });
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not update template"));
    } finally {
      setBusyId(null);
    }
  }

  async function onDelete(t: NotificationTemplate) {
    if (!confirm(`Delete the ${EVENT_LABEL[t.event_type]} / ${t.channel} template?`)) return;
    setBusyId(t.id);
    setError(null);
    try {
      await deleteTemplate(t.id);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not delete template"));
    } finally {
      setBusyId(null);
    }
  }

  const set = <K extends keyof TemplateInput>(k: K, v: TemplateInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const rows = templates ?? [];

  return (
    <Card className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">Message templates for this gym</p>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" /> Add template
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : rows.length === 0 ? (
        <EmptyState title="No templates yet" hint="Add a template to start sending messages." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted">
              <tr className="border-b border-border">
                <th className="px-3 py-3">Event</th>
                <th className="px-3 py-3">Channel</th>
                <th className="px-3 py-3">Subject</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="border-b border-border/60 hover:bg-surface-2/50">
                  <td className="px-3 py-3 font-medium">{EVENT_LABEL[t.event_type]}</td>
                  <td className="px-3 py-3">
                    <Badge tone={CHANNEL_TONE[t.channel]}>{t.channel}</Badge>
                  </td>
                  <td className="px-3 py-3 text-muted">{t.subject || "—"}</td>
                  <td className="px-3 py-3">
                    <Badge tone={t.is_active ? "success" : "neutral"}>
                      {t.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="secondary"
                        className="px-3 py-1.5 text-xs"
                        onClick={() => openEdit(t)}
                      >
                        <Pencil className="h-4 w-4" /> Edit
                      </Button>
                      <Button
                        variant="secondary"
                        className="px-2 py-1.5 text-xs"
                        onClick={() => onToggle(t)}
                        disabled={busyId === t.id}
                        title={t.is_active ? "Deactivate" : "Activate"}
                      >
                        <Power className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        className="px-2 py-1.5 text-xs"
                        onClick={() => onDelete(t)}
                        disabled={busyId === t.id}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Edit template" : "Add template"}
      >
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            label="Event type"
            value={form.event_type}
            onChange={(e) => set("event_type", e.target.value as EventType)}
          >
            {EVENT_TYPES.map((ev) => (
              <option key={ev} value={ev}>
                {EVENT_LABEL[ev]}
              </option>
            ))}
          </Select>
          <Select
            label="Channel"
            value={form.channel}
            onChange={(e) => set("channel", e.target.value as Channel)}
          >
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <div className="sm:col-span-2">
            <Input
              label="Subject (optional)"
              value={form.subject ?? ""}
              maxLength={200}
              onChange={(e) => set("subject", e.target.value)}
              placeholder="Used for email; ignored by WhatsApp"
            />
          </div>
          <div className="sm:col-span-2 space-y-1.5">
            <label htmlFor="template-body" className="block text-sm font-medium text-muted">
              Body
            </label>
            <textarea
              id="template-body"
              value={form.body}
              onChange={(e) => set("body", e.target.value)}
              rows={5}
              maxLength={2000}
              required
              className="w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm text-white placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-brand/60"
            />
            <p className="text-xs text-muted">
              {"Use placeholders like {member.name}, {gym.name}, {membership.end_date}, {payment.amount}."}
            </p>
          </div>
          {formError && <p className="text-sm text-danger sm:col-span-2">{formError}</p>}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {editing ? "Save changes" : "Create template"}
            </Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}

/* ---------------- Tab 3: manual send ---------------- */

type SendMode = "pair" | "template";

function SendTab() {
  const [mode, setMode] = useState<SendMode>("pair");
  const [member, setMember] = useState<MemberLookup | null>(null);
  const [eventType, setEventType] = useState<EventType>("welcome");
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [templateId, setTemplateId] = useState("");
  const [membershipId, setMembershipId] = useState("");
  const [paymentId, setPaymentId] = useState("");
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<NotificationLog | null>(null);

  // Load templates for the "specific template" picker; pair mode works without them.
  useEffect(() => {
    let active = true;
    listTemplates()
      .then((t) => {
        if (active) setTemplates(t);
      })
      .catch(() => {
        /* picker is optional; the event-type + channel path still works */
      });
    return () => {
      active = false;
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!member) {
      setError("Select a member to send to.");
      return;
    }
    if (mode === "template" && !templateId) {
      setError("Choose a template.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const payload: ManualSend =
        mode === "template"
          ? { member_id: member.id, template_id: Number(templateId) }
          : { member_id: member.id, event_type: eventType, channel };
      if (membershipId) payload.membership_id = Number(membershipId);
      if (paymentId) payload.payment_id = Number(paymentId);
      setResult(await sendNotification(payload));
    } catch (err) {
      // Preserve the entered input; only surface the error.
      setError(apiErrorMessage(err, "Could not send notification"));
    } finally {
      setSending(false);
    }
  }

  const isDryRun = result?.provider_ref?.startsWith("dryrun:") ?? false;

  return (
    <Card className="space-y-5 p-5">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-muted">Member</label>
          <MemberSearch
            selected={member}
            onSelect={setMember}
            onClear={() => setMember(null)}
          />
        </div>

        <Select
          label="Send by"
          value={mode}
          onChange={(e) => setMode(e.target.value as SendMode)}
        >
          <option value="pair">Event type + channel</option>
          <option value="template">Specific template</option>
        </Select>

        {mode === "pair" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label="Event type"
              value={eventType}
              onChange={(e) => setEventType(e.target.value as EventType)}
            >
              {EVENT_TYPES.map((ev) => (
                <option key={ev} value={ev}>
                  {EVENT_LABEL[ev]}
                </option>
              ))}
            </Select>
            <Select
              label="Channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value as Channel)}
            >
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <Select
            label="Template"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            <option value="">Select a template…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {EVENT_LABEL[t.event_type]} · {t.channel}
                {t.is_active ? "" : " (inactive)"}
                {t.subject ? ` — ${t.subject}` : ""}
              </option>
            ))}
          </Select>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Membership ID (optional)"
            type="number"
            value={membershipId}
            onChange={(e) => setMembershipId(e.target.value)}
            placeholder="Adds membership context"
          />
          <Input
            label="Payment ID (optional)"
            type="number"
            value={paymentId}
            onChange={(e) => setPaymentId(e.target.value)}
            placeholder="Adds payment context"
          />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex justify-end">
          <Button type="submit" loading={sending} disabled={!member}>
            <Send className="h-4 w-4" /> Send notification
          </Button>
        </div>
      </form>

      {result && (
        <div
          className={clsx(
            "flex items-start gap-3 rounded-xl border p-4",
            result.status === "sent"
              ? "border-success/30 bg-success/10"
              : "border-danger/30 bg-danger/10"
          )}
        >
          <CheckCircle2
            className={clsx(
              "mt-0.5 h-5 w-5",
              result.status === "sent" ? "text-success" : "text-danger"
            )}
          />
          <div className="min-w-0 space-y-1 text-sm">
            <p className="flex items-center gap-2 font-semibold">
              {result.status === "sent" ? "Notification recorded" : "Delivery failed"}
              <Badge tone={STATUS_TONE[result.status]}>{result.status}</Badge>
              {isDryRun && <Badge tone="warning">dry-run</Badge>}
            </p>
            <p className="text-muted">
              {result.member_name ?? `Member #${result.member_id}`} · {eventLabel(result.event_type)}{" "}
              · {result.channel}
            </p>
            {result.provider_ref && (
              <p className="break-all font-mono text-xs text-muted">
                ref: {result.provider_ref}
                {isDryRun ? " — channel not configured, no message was sent" : ""}
              </p>
            )}
            {result.error && <p className="text-xs text-danger">{result.error}</p>}
          </div>
        </div>
      )}
    </Card>
  );
}

/* ---------------- Tab 4: run reminders ---------------- */

function RemindersTab() {
  const [withinDays, setWithinDays] = useState("7");
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReminderRunResult | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setRunning(true);
    setError(null);
    try {
      const res = await runReminders({
        within_days: withinDays ? Number(withinDays) : 7,
        channel,
      });
      setResult(res);
    } catch (err) {
      setError(apiErrorMessage(err, "Could not run reminders"));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card className="space-y-5 p-5">
      <div>
        <h2 className="font-semibold">Membership expiry reminders</h2>
        <p className="text-sm text-muted">
          Sends a <span className="font-medium text-white">membership_expiry</span> notification to
          every member whose active membership ends within the window.
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
        <div className="w-32">
          <Input
            label="Within days"
            type="number"
            min={1}
            max={90}
            value={withinDays}
            onChange={(e) => setWithinDays(e.target.value)}
          />
        </div>
        <div className="w-40">
          <Select
            label="Channel"
            value={channel}
            onChange={(e) => setChannel(e.target.value as Channel)}
          >
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" loading={running}>
          <RefreshCw className="h-4 w-4" /> Run reminders
        </Button>
      </form>

      {error && <p className="text-sm text-danger">{error}</p>}

      {result && (
        <div className="rounded-xl border border-success/30 bg-success/10 p-4 text-sm">
          <p className="flex items-center gap-2 font-semibold text-success">
            <CheckCircle2 className="h-5 w-5" /> Reminder run complete
          </p>
          <p className="mt-1 text-muted">
            Selected{" "}
            <span className="font-semibold text-white">{result.memberships_selected}</span>{" "}
            membership(s) expiring within{" "}
            <span className="font-semibold text-white">{result.within_days}</span> day(s) on{" "}
            <span className="font-semibold text-white">{result.channel}</span>, created{" "}
            <span className="font-semibold text-white">{result.notifications_created}</span>{" "}
            notification(s).
          </p>
        </div>
      )}
    </Card>
  );
}

/* ---------------- Page shell with tab switch ---------------- */

type Tab = "log" | "templates" | "send" | "reminders";

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "log", label: "History", icon: History },
  { id: "templates", label: "Templates", icon: FileText },
  { id: "send", label: "Manual send", icon: Send },
  { id: "reminders", label: "Run reminders", icon: BellRing },
];

export function NotificationsPage() {
  const [tab, setTab] = useState<Tab>("log");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Notifications</h1>
        <p className="text-sm text-muted">
          Review delivery history, manage templates, send messages, and run expiry reminders.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={clsx(
              "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all",
              tab === id
                ? "bg-brand-gradient text-[#080808] shadow-gold"
                : "bg-surface-2 text-muted hover:text-white"
            )}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {tab === "log" && <LogTab />}
      {tab === "templates" && <TemplatesTab />}
      {tab === "send" && <SendTab />}
      {tab === "reminders" && <RemindersTab />}
    </div>
  );
}
