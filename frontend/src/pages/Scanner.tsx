import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { AlertCircle, Camera, CheckCircle2, QrCode, Search, UserCheck } from "lucide-react";
import { Badge, Button, Card, Input } from "@/components/ui";
import { apiErrorMessage } from "@/lib/api";
import {
  CheckInResult,
  MemberLookup,
  checkIn,
  searchMembers,
} from "@/features/attendance/api";

/** Human-friendly message for a camera / getUserMedia failure. */
function cameraErrorMessage(e: unknown): string {
  const name =
    typeof e === "object" && e !== null ? (e as { name?: string }).name : undefined;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera permission was denied. Allow camera access, or use paste / search below.";
  }
  if (
    name === "NotFoundError" ||
    name === "DevicesNotFoundError" ||
    name === "OverconstrainedError"
  ) {
    return "No usable camera was found. Use paste / search below.";
  }
  return "Could not start the camera. Use paste / search below.";
}

export function ScannerPage() {
  // Shared check-in result / error (drives the banner at the top of the page).
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Paste-token fallback.
  const [token, setToken] = useState("");

  // Member-search fallback.
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberLookup[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Camera scanning (secure-context only).
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Camera is available only in a secure context with a usable mediaDevices API.
  // On plain HTTP (local LAN IP) this is false, so the paste/search fallbacks
  // are the baseline and the camera toggle is simply not rendered.
  const cameraSupported = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.isSecureContext &&
      !!navigator.mediaDevices?.getUserMedia,
    []
  );

  async function submitCheckIn(
    body: { token: string } | { member_id: number }
  ): Promise<boolean> {
    setSubmitting(true);
    setError(null);
    try {
      const res = await checkIn(body);
      setResult(res);
      return true;
    } catch (e) {
      // Keep inputs enabled for another attempt; surface the server message.
      setResult(null);
      setError(apiErrorMessage(e, "Check-in failed. Please try again."));
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmitToken(e: FormEvent) {
    e.preventDefault();
    const t = token.trim();
    if (!t) return;
    const ok = await submitCheckIn({ token: t });
    if (ok) setToken("");
  }

  async function onPickMember(m: MemberLookup) {
    const ok = await submitCheckIn({ member_id: m.id });
    if (ok) {
      setQuery("");
      setResults([]);
    }
  }

  // Debounced member search.
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

  // Camera lifecycle: start the ZXing reader when the toggle turns on; stop it on
  // unmount, when toggled off, and after a successful decode. ZXing is imported
  // dynamically so HTTP users never download it.
  useEffect(() => {
    if (!cameraOn) return;
    let cancelled = false;
    let controls: { stop: () => void } | null = null;

    (async () => {
      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        if (cancelled) return;
        const video = videoRef.current;
        if (!video) return;
        const reader = new BrowserQRCodeReader();
        controls = await reader.decodeFromVideoDevice(undefined, video, (res, _err, ctrl) => {
          if (!res) return; // not-found ticks fire continuously; ignore them
          ctrl.stop(); // release the camera immediately after a successful decode
          setCameraOn(false);
          void submitCheckIn({ token: res.getText() });
        });
        if (cancelled) {
          controls.stop();
          controls = null;
        }
      } catch (e) {
        if (!cancelled) {
          setCameraError(cameraErrorMessage(e));
          setCameraOn(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      controls?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn]);

  function toggleCamera() {
    setCameraError(null);
    setCameraOn((on) => !on);
  }

  const q = query.trim();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">QR Scanner</h1>
        <p className="text-sm text-muted">
          Check members in by scanning their QR code, pasting a token, or searching by name.
        </p>
      </div>

      {/* Result / error banner */}
      {result && (
        <div
          className={clsx(
            "flex items-start gap-3 rounded-2xl border p-4",
            result.created
              ? "border-success/30 bg-success/10"
              : "border-warning/30 bg-warning/10"
          )}
        >
          <CheckCircle2
            className={clsx("mt-0.5 h-5 w-5", result.created ? "text-success" : "text-warning")}
          />
          <div>
            <p
              className={clsx(
                "font-semibold",
                result.created ? "text-success" : "text-warning"
              )}
            >
              {result.created ? "Checked in" : "Already checked in today"}
            </p>
            <p className="text-sm text-white">
              {result.attendance.member_name}{" "}
              <span className="font-mono text-xs text-muted">
                {result.attendance.member_code}
              </span>
            </p>
          </div>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-danger/30 bg-danger/10 p-4">
          <AlertCircle className="mt-0.5 h-5 w-5 text-danger" />
          <p className="text-sm text-danger">{error}</p>
        </div>
      )}

      {/* Camera (secure-context only) */}
      {cameraSupported && (
        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-brand">
              <Camera className="h-5 w-5" />
              <h2 className="font-semibold">Camera</h2>
            </div>
            <Button variant={cameraOn ? "secondary" : "primary"} onClick={toggleCamera}>
              {cameraOn ? "Stop camera" : "Scan with camera"}
            </Button>
          </div>
          {cameraOn && (
            <div className="overflow-hidden rounded-xl border border-border bg-black">
              <video
                ref={videoRef}
                className="mx-auto max-h-80 w-full object-contain"
                muted
                playsInline
              />
            </div>
          )}
          {cameraError ? (
            <p className="text-sm text-danger">{cameraError}</p>
          ) : (
            <p className="text-sm text-muted">
              Point the camera at a member's QR code. The check-in happens automatically on a
              successful scan.
            </p>
          )}
        </Card>
      )}

      {/* Paste token */}
      <Card className="space-y-4">
        <div className="flex items-center gap-2 text-brand">
          <QrCode className="h-5 w-5" />
          <h2 className="font-semibold">Paste token</h2>
        </div>
        <form onSubmit={onSubmitToken} className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <Input
              label="QR token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste the member's QR token"
              autoComplete="off"
            />
          </div>
          <Button type="submit" loading={submitting} disabled={!token.trim()}>
            Check in
          </Button>
        </form>
      </Card>

      {/* Search member */}
      <Card className="space-y-4">
        <div className="flex items-center gap-2 text-brand">
          <Search className="h-5 w-5" />
          <h2 className="font-semibold">Search member</h2>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, code, phone, or email"
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
              <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{m.name}</p>
                  <p className="font-mono text-xs text-muted">
                    {m.member_code}
                    {m.phone ? ` · ${m.phone}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Badge tone={m.status === "active" ? "success" : "neutral"}>{m.status}</Badge>
                  <Button
                    variant="secondary"
                    className="px-3 py-1.5 text-xs"
                    onClick={() => onPickMember(m)}
                    disabled={submitting}
                  >
                    <UserCheck className="h-4 w-4" /> Check in
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </div>
  );
}
