import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { clsx } from "clsx";
import { Dumbbell, Menu, X } from "lucide-react";
import { BRAND } from "@/brand";
import { useAuthStore } from "@/lib/auth";

export function PublicNavbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const isAuthed = useAuthStore((s) => !!s.tokens);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={clsx(
        "fixed inset-x-0 top-0 z-50 transition-all duration-300",
        scrolled ? "border-b border-border bg-base/85 backdrop-blur-md" : "bg-transparent"
      )}
    >
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-6 lg:px-8">
        <Link to="/" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-gradient text-[#080808]">
            <Dumbbell className="h-5 w-5" />
          </span>
          <span className="font-display text-lg font-bold uppercase tracking-wide">
            {BRAND.short}
          </span>
        </Link>

        <div className="hidden items-center gap-8 lg:flex">
          {BRAND.nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                clsx(
                  "text-sm font-medium transition-colors",
                  isActive ? "text-brand" : "text-muted hover:text-white"
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>

        <div className="hidden items-center gap-3 lg:flex">
          {isAuthed ? (
            <button
              onClick={() => navigate("/app")}
              className="rounded-xl bg-brand-gradient px-5 py-2 text-sm font-semibold text-[#080808] shadow-gold transition hover:brightness-105"
            >
              Dashboard
            </button>
          ) : (
            <>
              <Link to="/login" className="text-sm font-medium text-white/90 hover:text-white">
                Log In
              </Link>
              <Link
                to="/memberships"
                className="rounded-xl bg-brand-gradient px-5 py-2 text-sm font-semibold text-[#080808] shadow-gold transition hover:brightness-105"
              >
                Join Now
              </Link>
            </>
          )}
        </div>

        <button
          className="rounded-lg p-2 text-white lg:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>

      {/* Mobile menu */}
      <div
        className={clsx(
          "overflow-hidden border-t border-border bg-base/95 backdrop-blur-md transition-all duration-300 lg:hidden",
          open ? "max-h-96" : "max-h-0 border-t-0"
        )}
      >
        <div className="space-y-1 px-5 py-4">
          {BRAND.nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                clsx(
                  "block rounded-lg px-3 py-2.5 text-sm font-medium",
                  isActive ? "bg-brand/10 text-brand" : "text-muted hover:bg-surface-2 hover:text-white"
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
          <div className="flex gap-3 pt-3">
            {isAuthed ? (
              <button
                onClick={() => { setOpen(false); navigate("/app"); }}
                className="flex-1 rounded-xl bg-brand-gradient px-4 py-2.5 text-center text-sm font-semibold text-[#080808]"
              >
                Dashboard
              </button>
            ) : (
              <>
                <Link to="/login" onClick={() => setOpen(false)} className="flex-1 rounded-xl border border-border px-4 py-2.5 text-center text-sm font-medium">
                  Log In
                </Link>
                <Link to="/memberships" onClick={() => setOpen(false)} className="flex-1 rounded-xl bg-brand-gradient px-4 py-2.5 text-center text-sm font-semibold text-[#080808]">
                  Join Now
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
