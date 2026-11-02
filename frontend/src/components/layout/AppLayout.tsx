import { useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { Menu, LogOut, Search } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { useAuthStore } from "@/lib/auth";
import { BRAND } from "@/brand";

export function AppLayout() {
  const [open, setOpen] = useState(false);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  if (!user) return null;
  // Members use the portal, not the staff admin area.
  if (user.role === "member") return <Navigate to="/portal" replace />;

  return (
    <div className="min-h-screen bg-base">
      <Sidebar role={user.role} gymName={BRAND.short} open={open} />

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-base/80 px-4 py-3 backdrop-blur">
          <button
            onClick={() => setOpen((v) => !v)}
            className="rounded-lg p-2 text-muted hover:bg-surface-2 lg:hidden"
            aria-label="Toggle navigation"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="relative hidden flex-1 max-w-md sm:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              placeholder="Search..."
              className="w-full rounded-xl border border-border bg-surface px-9 py-2 text-sm text-white placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-brand/60"
            />
          </div>

          <div className="ml-auto flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-semibold leading-tight">{user.full_name || user.email}</p>
              <p className="text-xs capitalize text-muted">{user.role}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-gradient text-sm font-bold">
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
        </header>

        <main className="p-4 sm:p-6">
          <Outlet />
        </main>
      </div>

      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
        />
      )}
    </div>
  );
}
