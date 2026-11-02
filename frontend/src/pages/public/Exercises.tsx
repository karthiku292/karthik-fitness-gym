import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Search, X, Dumbbell, AlertTriangle, ShieldCheck, Target, ListChecks } from "lucide-react";
import { clsx } from "clsx";
import { IMAGES } from "@/brand";
import { Container, Section, SectionHeading, Reveal } from "@/components/public/primitives";
import { PageHero } from "@/components/public/PageHero";
import { ExerciseImage } from "@/components/public/ExerciseImage";
import {
  CATEGORIES, EXERCISES, WORKOUT_PLANS, type Difficulty, type Exercise,
} from "@/features/exercises/data";

const DIFF_TONE: Record<Difficulty, string> = {
  Beginner: "bg-success/15 text-success",
  Intermediate: "bg-warning/15 text-warning",
  Advanced: "bg-danger/15 text-danger",
};

export function ExercisesPage() {
  const [cat, setCat] = useState<string>("All");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Exercise | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return EXERCISES.filter((e) => {
      const inCat = cat === "All" || e.category === cat;
      const inQuery = !q || e.name.toLowerCase().includes(q) || e.muscle.toLowerCase().includes(q);
      return inCat && inQuery;
    });
  }, [cat, query]);

  return (
    <>
      <PageHero
        eyebrow="Exercise Library"
        title={<>Train with <span className="text-gradient-gold">perfect form</span></>}
        subtitle="Browse professional demonstrations for every major muscle group — with sets, reps, cues and safety tips."
        image={IMAGES.strength}
      />

      <Section>
        <Container>
          {/* Controls */}
          <div className="flex flex-col gap-4">
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search exercises or muscles"
                className="w-full rounded-xl border border-border bg-surface px-9 py-2.5 text-sm text-white placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-brand/60"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {["All", ...CATEGORIES].map((c) => (
                <button
                  key={c}
                  onClick={() => setCat(c)}
                  className={clsx(
                    "rounded-full border px-4 py-1.5 text-sm font-medium transition",
                    cat === c
                      ? "border-brand bg-brand/15 text-brand"
                      : "border-border text-muted hover:text-white"
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Grid */}
          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((ex, i) => (
              <Reveal key={ex.id} delay={(i % 3) * 0.05}>
                <button
                  onClick={() => setSelected(ex)}
                  className="group block w-full overflow-hidden rounded-2xl border border-border bg-surface text-left transition hover:border-brand/50"
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-surface-2">
                    <ExerciseImage ex={ex} className="transition-transform duration-500 group-hover:scale-105" />
                    <span className={clsx("absolute left-3 top-3 rounded-full px-2.5 py-0.5 text-xs font-semibold", DIFF_TONE[ex.difficulty])}>
                      {ex.difficulty}
                    </span>
                  </div>
                  <div className="p-4">
                    <h3 className="font-display text-lg font-bold uppercase group-hover:text-brand">{ex.name}</h3>
                    <p className="text-sm text-muted">{ex.muscle}</p>
                    <div className="mt-3 flex items-center gap-4 text-xs text-muted">
                      <span className="inline-flex items-center gap-1"><Dumbbell className="h-3.5 w-3.5 text-brand" /> {ex.sets} sets</span>
                      <span>· {ex.reps} reps</span>
                    </div>
                  </div>
                </button>
              </Reveal>
            ))}
          </div>
          {filtered.length === 0 && (
            <p className="py-16 text-center text-muted">No exercises match your search.</p>
          )}
        </Container>
      </Section>

      {/* Workout plans */}
      <Section className="bg-surface">
        <Container>
          <SectionHeading center eyebrow="Workout Plans" title={<>Programs for <span className="text-gradient-gold">every level</span></>} />
          <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
            {WORKOUT_PLANS.map((p, i) => (
              <Reveal key={p.name} delay={i * 0.08}>
                <div className="group overflow-hidden rounded-2xl border border-border bg-base">
                  <div className="relative aspect-[16/10] overflow-hidden">
                    <img src={p.image} alt={p.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                    <div className="absolute inset-0 bg-gradient-to-t from-base to-transparent" />
                    <span className={clsx("absolute left-3 top-3 rounded-full px-2.5 py-0.5 text-xs font-semibold", DIFF_TONE[p.level])}>{p.level}</span>
                  </div>
                  <div className="p-5">
                    <h3 className="font-display text-xl font-bold uppercase">{p.name}</h3>
                    <p className="mt-1 text-sm text-brand">{p.schedule}</p>
                    <p className="mt-2 text-sm text-muted">{p.blurb}</p>
                    <ul className="mt-3 space-y-1">
                      {p.focus.map((f) => (
                        <li key={f} className="text-xs text-muted">• {f}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
          <div className="mt-10 text-center">
            <Link to="/memberships" className="inline-block rounded-xl bg-brand-gradient px-7 py-3 text-sm font-semibold text-[#080808] shadow-gold transition hover:brightness-105">
              Get a Custom Plan
            </Link>
          </div>
        </Container>
      </Section>

      {/* Detail modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setSelected(null)} />
          <div className="relative z-10 my-4 w-full max-w-3xl rounded-2xl border border-border bg-surface shadow-card">
            <button
              onClick={() => setSelected(null)}
              className="absolute right-4 top-4 z-10 rounded-lg bg-base/60 p-2 text-muted hover:text-white"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="grid gap-0 sm:grid-cols-2">
              <div className="aspect-square overflow-hidden rounded-t-2xl bg-surface-2 sm:rounded-l-2xl sm:rounded-tr-none">
                <ExerciseImage ex={selected} frame={0} />
              </div>
              <div className="aspect-square overflow-hidden bg-surface-2 sm:rounded-tr-2xl">
                <ExerciseImage ex={selected} frame={1} />
              </div>
            </div>

            <div className="p-6">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="font-display text-2xl font-bold uppercase">{selected.name}</h2>
                <span className={clsx("rounded-full px-2.5 py-0.5 text-xs font-semibold", DIFF_TONE[selected.difficulty])}>{selected.difficulty}</span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Meta icon={<Target className="h-4 w-4" />} label="Target" value={selected.muscle} />
                <Meta icon={<Dumbbell className="h-4 w-4" />} label="Equipment" value={selected.equipment} />
                <Meta icon={<ListChecks className="h-4 w-4" />} label="Sets" value={selected.sets} />
                <Meta icon={<ListChecks className="h-4 w-4" />} label="Reps" value={selected.reps} />
              </div>

              <Block title="Step-by-step" icon={<ListChecks className="h-4 w-4 text-brand" />}>
                <ol className="list-decimal space-y-1.5 pl-5 text-sm text-white/85">
                  {selected.instructions.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              </Block>

              <div className="grid gap-5 sm:grid-cols-2">
                <Block title="Common mistakes" icon={<AlertTriangle className="h-4 w-4 text-warning" />}>
                  <ul className="space-y-1.5 text-sm text-white/85">
                    {selected.mistakes.map((s, i) => <li key={i} className="flex gap-2"><span className="text-warning">•</span>{s}</li>)}
                  </ul>
                </Block>
                <Block title="Safety tips" icon={<ShieldCheck className="h-4 w-4 text-success" />}>
                  <ul className="space-y-1.5 text-sm text-white/85">
                    {selected.tips.map((s, i) => <li key={i} className="flex gap-2"><span className="text-success">•</span>{s}</li>)}
                  </ul>
                </Block>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Meta({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-base p-3">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted">{icon}{label}</div>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}

function Block({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-6">
      <h3 className="mb-2 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wide">{icon}{title}</h3>
      {children}
    </div>
  );
}
