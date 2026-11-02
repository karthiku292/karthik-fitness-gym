import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Loader2, Dumbbell } from "lucide-react";
import { clsx } from "clsx";
import type { MembershipPlan } from "@/lib/types";
import { getPublicPlans } from "@/features/public/api";
import { apiErrorMessage } from "@/lib/api";

const DEFAULT_PERKS = [
  "Unlimited gym & equipment access",
  "All group classes included",
  "Personal locker & showers",
  "Fitness assessment",
];

function durationLabel(days: number): string {
  const months = Math.round(days / 30);
  if (days >= 360) return "12 Months";
  if (months >= 1 && days % 30 === 0) return `${months} ${months === 1 ? "Month" : "Months"}`;
  return `${days} Days`;
}

function monthsOf(days: number): number {
  return Math.max(1, Math.round(days / 30));
}

/**
 * Cult.fit-style membership pack: one premium card with a duration selector.
 * Price, per-month breakdown and savings update as you switch durations.
 * Driven by live plans from the backend (no demo data).
 */
export function MembershipPack() {
  const [plans, setPlans] = useState<MembershipPlan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    getPublicPlans()
      .then((p) => {
        if (!active) return;
        const sorted = [...p].sort((a, b) => a.duration_days - b.duration_days);
        setPlans(sorted);
        // Default-select the longest (best value) plan, like Cult.fit.
        if (sorted.length) setSelectedId(sorted[sorted.length - 1].id);
      })
      .catch((e) => active && setError(apiErrorMessage(e, "Could not load plans")))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const baselinePerMonth = useMemo(() => {
    if (!plans || plans.length === 0) return 0;
    const shortest = plans[0];
    return Number(shortest.price) / monthsOf(shortest.duration_days);
  }, [plans]);

  const selected = plans?.find((p) => p.id === selectedId) ?? null;

  if (loading) {
    return (
      <div className="flex justify-center py-20 text-brand">
        <Loader2 className="h-7 w-7 animate-spin" />
      </div>
    );
  }
  if (error) {
    return <div className="rounded-2xl border border-border bg-surface p-8 text-center text-muted">{error}</div>;
  }
  if (!plans || plans.length === 0 || !selected) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-8 text-center text-muted">
        Plans will be published shortly. Please contact us for current pricing.
      </div>
    );
  }

  const months = monthsOf(selected.duration_days);
  const total = Number(selected.price);
  const perMonth = total / months;
  const savings =
    baselinePerMonth > 0 ? Math.round((1 - perMonth / baselinePerMonth) * 100) : 0;
  const perks = selected.features?.length ? selected.features : DEFAULT_PERKS;

  return (
    <div className="mx-auto max-w-3xl">
      {/* Duration toggle */}
      <div className="flex flex-wrap justify-center gap-2 rounded-2xl border border-border bg-surface p-2">
        {plans.map((p) => {
          const active = p.id === selected.id;
          return (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className={clsx(
                "relative flex-1 whitespace-nowrap rounded-xl px-4 py-3 text-sm font-semibold transition",
                active ? "bg-brand-gradient text-[#080808] shadow-gold" : "text-muted hover:text-white"
              )}
            >
              {durationLabel(p.duration_days)}
            </button>
          );
        })}
      </div>

      {/* Selected plan card */}
      <div className="relative mt-6 overflow-hidden rounded-3xl border border-brand/40 bg-surface p-8 shadow-gold sm:p-10">
        <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-brand/15 blur-3xl" />
        <div className="relative">
          <div className="flex items-center gap-2 text-brand">
            <Dumbbell className="h-5 w-5" />
            <span className="text-sm font-semibold uppercase tracking-[0.2em]">{selected.name}</span>
          </div>

          <div className="mt-5 flex flex-wrap items-end gap-x-4 gap-y-2">
            <span className="font-display text-5xl font-bold text-white">
              ₹{total.toLocaleString()}
            </span>
            <div className="mb-1 text-sm text-muted">
              <p>₹{Math.round(perMonth).toLocaleString()} / month</p>
              <p>{durationLabel(selected.duration_days)} validity</p>
            </div>
            {savings > 0 && (
              <span className="mb-1.5 rounded-full bg-success/15 px-3 py-1 text-xs font-semibold text-success">
                SAVE {savings}%
              </span>
            )}
          </div>

          {selected.description && <p className="mt-4 text-muted">{selected.description}</p>}

          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {perks.map((perk, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-white/85">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                {perk}
              </li>
            ))}
          </ul>

          <Link
            to={`/contact?plan=${encodeURIComponent(`${selected.name} — ${durationLabel(selected.duration_days)}`)}`}
            className="mt-8 block rounded-xl bg-brand-gradient py-4 text-center text-sm font-bold uppercase tracking-wide text-[#080808] shadow-gold transition hover:brightness-105"
          >
            Join Now · ₹{total.toLocaleString()}
          </Link>
          <p className="mt-3 text-center text-xs text-muted">
            No hidden fees · Cancel anytime · Instant activation at the front desk
          </p>
        </div>
      </div>
    </div>
  );
}
