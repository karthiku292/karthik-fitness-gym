import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Dumbbell, ArrowLeft, Eye, EyeOff } from "lucide-react";
import axios from "axios";
import { clsx } from "clsx";
import { Button, Card, Input } from "@/components/ui";
import { useAuthStore } from "@/lib/auth";
import { apiErrorMessage } from "@/lib/api";
import { useBranding } from "@/lib/branding";

type Mode = "member" | "staff";
type MemberStep = "phone" | "code";

const RESEND_COOLDOWN = 60; // seconds between code requests (mirrors the backend cooldown)

// Vite injects import.meta.env.DEV; read it defensively so this file stays
// type-safe without depending on the vite/client ambient types. This is a
// defence-in-depth gate — the backend only ever returns `dev_code` outside
// production with an unconfigured provider.
const IS_DEV = Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);

// A 429 carries the wait time in the JSON body (`retry_after`) and the
// `Retry-After` header. Pull whichever is present so we can run a countdown.
function retryAfterFrom(err: unknown): number | null {
  if (!axios.isAxiosError(err) || err.response?.status !== 429) return null;
  const body = err.response.data as { retry_after?: number | null } | undefined;
  if (body && typeof body.retry_after === "number" && body.retry_after > 0) {
    return body.retry_after;
  }
  const header = err.response.headers?.["retry-after"];
  const n = Number(header);
  return Number.isFinite(n) && n > 0 ? n : RESEND_COOLDOWN;
}

export function LoginPage() {
  const navigate = useNavigate();
  const b = useBranding();
  const login = useAuthStore((s) => s.login);
  const otpRequest = useAuthStore((s) => s.otpRequest);
  const otpVerify = useAuthStore((s) => s.otpVerify);

  const [mode, setMode] = useState<Mode>("member");

  // Member (phone + OTP) state.
  const [phone, setPhone] = useState("");
  const [step, setStep] = useState<MemberStep>("phone");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  // Staff (email + password) state.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);

  // Shared UI state.
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);

  // Tick the resend/retry countdown down to zero.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => (c > 0 ? c - 1 : 0)), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null); // keep every entered value; only clear the stale message
  }

  function backToPhone() {
    setStep("phone");
    setCode("");
    setDevCode(null);
    setError(null);
  }

  // Request (or resend) a one-time passcode for the entered phone.
  async function requestCode(kind: "send" | "resend") {
    setError(null);
    const setBusy = kind === "resend" ? setResending : setSubmitting;
    setBusy(true);
    try {
      const res = await otpRequest(phone.trim());
      setDevCode(res.dev_code ?? null);
      setStep("code");
      // Normal success has no retry_after; fall back to the standard cooldown.
      setCooldown(res.retry_after && res.retry_after > 0 ? res.retry_after : RESEND_COOLDOWN);
    } catch (err) {
      const retry = retryAfterFrom(err);
      if (retry != null) setCooldown(retry); // drive a countdown on 429
      setError(apiErrorMessage(err, "Could not send the code. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  function onSendCode(e: FormEvent) {
    e.preventDefault();
    void requestCode("send");
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await otpVerify(phone.trim(), code.trim());
      navigate("/portal");
    } catch (err) {
      // Preserve the phone, code, and step so the member can retry.
      setError(apiErrorMessage(err, "That code is invalid or has expired."));
    } finally {
      setSubmitting(false);
    }
  }

  async function onStaffSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate("/app");
    } catch (err) {
      setError(apiErrorMessage(err, "Invalid email or password"));
    } finally {
      setSubmitting(false);
    }
  }

  const errorBanner = error ? (
    <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
      {error}
    </p>
  ) : null;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-base px-4">
      {/* Full-screen gym background: your own photo at public/hero-bg.jpg, else fallback. */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage:
            "url('/hero-bg.jpg'), url('https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=1600&q=80')",
        }}
      />
      <div className="absolute inset-0 bg-base/80" />
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-brand/20 blur-[120px]" />
      </div>

      <Link
        to="/"
        className="absolute left-5 top-5 z-10 inline-flex items-center gap-2 text-sm text-muted transition hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" /> Back to site
      </Link>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative w-full max-w-md"
      >
        <div className="mb-6 flex flex-col items-center gap-3">
          {b.logoUrl ? (
            <img src={b.logoUrl} alt={b.name} className="h-14 w-14 rounded-2xl object-cover" />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient text-[#080808]">
              <Dumbbell className="h-7 w-7" />
            </div>
          )}
          <h1 className="font-display text-xl font-bold uppercase tracking-wide">{b.name}</h1>
          <p className="text-sm text-muted">
            {mode === "member" ? "Sign in with your mobile number" : "Staff & admin sign in"}
          </p>
        </div>

        <Card className="space-y-4">
          {/* Mode control: member code flow vs. staff/admin email + password. */}
          <div
            role="group"
            aria-label="Choose how to sign in"
            className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface-2 p-1"
          >
            <button
              type="button"
              onClick={() => switchMode("member")}
              aria-pressed={mode === "member"}
              className={clsx(
                "rounded-lg px-3 py-2 text-sm font-medium transition",
                mode === "member"
                  ? "bg-brand-gradient text-[#080808]"
                  : "text-muted hover:text-white"
              )}
            >
              Member
            </button>
            <button
              type="button"
              onClick={() => switchMode("staff")}
              aria-pressed={mode === "staff"}
              className={clsx(
                "rounded-lg px-3 py-2 text-sm font-medium transition",
                mode === "staff"
                  ? "bg-brand-gradient text-[#080808]"
                  : "text-muted hover:text-white"
              )}
            >
              Staff / Admin
            </button>
          </div>

          {mode === "member" && step === "phone" && (
            <form onSubmit={onSendCode} className="space-y-4">
              <Input
                id="phone"
                type="tel"
                inputMode="tel"
                label="Mobile number"
                placeholder="e.g. +1 555 123 4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                autoComplete="tel"
                autoFocus
              />
              {errorBanner}
              <Button type="submit" loading={submitting} disabled={cooldown > 0} className="w-full">
                {cooldown > 0 ? `Retry in ${cooldown}s` : "Send code"}
              </Button>
              <p className="text-center text-xs text-muted">
                We&apos;ll text you a 6-digit code to sign in — no password needed.
              </p>
            </form>
          )}

          {mode === "member" && step === "code" && (
            <form onSubmit={onVerify} className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-muted">
                  Code sent to <span className="font-medium text-white">{phone}</span>
                </p>
                <button
                  type="button"
                  onClick={backToPhone}
                  className="text-xs font-medium text-brand hover:underline"
                >
                  Change number
                </button>
              </div>
              <Input
                id="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                label="Verification code"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                maxLength={10}
                autoFocus
              />
              {IS_DEV && devCode && (
                <p
                  role="status"
                  className="rounded-lg bg-brand/10 px-3 py-2 text-sm text-brand"
                >
                  Dev code: <span className="font-mono font-semibold">{devCode}</span>
                </p>
              )}
              {errorBanner}
              <Button type="submit" loading={submitting} disabled={resending} className="w-full">
                Verify &amp; sign in
              </Button>
              <div className="flex items-center justify-center gap-1 text-xs text-muted">
                <span>Didn&apos;t get it?</span>
                <button
                  type="button"
                  onClick={() => void requestCode("resend")}
                  disabled={cooldown > 0 || resending || submitting}
                  className="font-medium text-brand transition hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60"
                >
                  {resending
                    ? "Resending…"
                    : cooldown > 0
                      ? `Resend in ${cooldown}s`
                      : "Resend code"}
                </button>
              </div>
            </form>
          )}

          {mode === "staff" && (
            <form onSubmit={onStaffSubmit} className="space-y-4">
              <Input
                id="email"
                type="email"
                label="Email"
                placeholder="you@gym.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
                autoFocus
              />
              <div className="relative">
                <Input
                  id="password"
                  type={showPw ? "text" : "password"}
                  label="Password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-3 top-[34px] text-muted transition hover:text-white"
                  aria-label={showPw ? "Hide password" : "Show password"}
                  tabIndex={-1}
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errorBanner}
              <Button type="submit" loading={submitting} className="w-full">
                Sign in
              </Button>
            </form>
          )}
        </Card>

        <p className="mt-5 text-center text-sm text-muted">
          New here?{" "}
          <Link to="/memberships" className="font-medium text-brand hover:underline">
            View memberships
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
