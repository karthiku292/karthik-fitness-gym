import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Dumbbell, ArrowLeft, Eye, EyeOff } from "lucide-react";
import { Button, Card, Input } from "@/components/ui";
import { useAuthStore } from "@/lib/auth";
import { apiErrorMessage } from "@/lib/api";
import { useBranding } from "@/lib/branding";

export function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const b = useBranding();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      const role = useAuthStore.getState().user?.role;
      navigate(role === "member" ? "/portal" : "/app");
    } catch (err) {
      setError(apiErrorMessage(err, "Invalid email or password"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-base px-4">
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
          <p className="text-sm text-muted">Sign in to your account</p>
        </div>

        <Card className="space-y-4">
          <form onSubmit={onSubmit} className="space-y-4">
            <Input
              id="email"
              type="email"
              label="Email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
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
            {error && (
              <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
            )}
            <Button type="submit" loading={loading} className="w-full">
              Sign In
            </Button>
          </form>
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
