import { useEffect, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "@/lib/auth";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const tokens = useAuthStore((s) => s.tokens);
  const user = useAuthStore((s) => s.user);
  const loadMe = useAuthStore((s) => s.loadMe);
  const logout = useAuthStore((s) => s.logout);
  const [checking, setChecking] = useState(!user && !!tokens);

  useEffect(() => {
    if (tokens && !user) {
      loadMe()
        .catch(() => logout())
        .finally(() => setChecking(false));
    } else {
      setChecking(false);
    }
  }, [tokens, user, loadMe, logout]);

  if (!tokens) return <Navigate to="/login" replace />;
  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-base">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-brand/40 border-t-brand" />
      </div>
    );
  }
  return <>{children}</>;
}
