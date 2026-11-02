import { Navigate, Outlet, Link } from "react-router-dom";
import { Dumbbell, LogOut } from "lucide-react";
import { useAuthStore } from "@/lib/auth";
import { BRAND } from "@/brand";

export function PortalLayout() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  if (!user) return null;
  // Staff don't belong in the member portal.
  if (user.role !== "member") return <Navigate to="/app" replace />;

  return (
    <div className="min-h-screen bg-base">
      <header className="sticky top-0 z-30 border-b border-border bg-base/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5">
          <Link to="/portal" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-gradient text-[#080808]">
              <Dumbbell className="h-5 w-5" />
            </span>
            <span className="font-display text-base font-bold uppercase">{BRAND.short}</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/" className="hidden text-sm text-muted hover:text-white sm:block">
              Main site
            </Link>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-gradient text-sm font-bold text-[#080808]">
              {(user.full_name || user.email).charAt(0).toUpperCase()}
            </div>
            <button
              onClick={logout}
              className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-white"
              aria-label="Log out"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-8">
        <Outlet />
      </main>
    </div>
  );
}
