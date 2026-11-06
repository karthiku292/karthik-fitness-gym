import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { ArrowRight, Dumbbell, Star, ShieldCheck, Clock, Trophy } from "lucide-react";
import { IMAGES } from "@/brand";
import { useBranding } from "@/lib/branding";
import { DisplayTrainer, getDisplayTrainers } from "@/features/trainers/api";
import {
  Container,
  Counter,
  Eyebrow,
  Media,
  Reveal,
  Section,
  SectionHeading,
} from "@/components/public/primitives";
import { MembershipPack } from "@/components/public/MembershipPack";
import { FaqAccordion } from "@/components/public/Faq";
import { PROGRAMS, STATS, TESTIMONIALS } from "@/features/public/content";

export function HomePage() {
  const b = useBranding();
  const [trainers, setTrainers] = useState<DisplayTrainer[]>([]);
  useEffect(() => {
    let active = true;
    getDisplayTrainers().then((t) => active && setTrainers(t.slice(0, 4)));
    return () => {
      active = false;
    };
  }, []);
  return (
    <>
      {/* ---------------- Hero ---------------- */}
      <section className="relative flex min-h-screen items-center overflow-hidden">
        <div className="absolute inset-0">
          <img src={IMAGES.hero} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-base via-base/90 to-base/40" />
          <div className="absolute inset-0 bg-gradient-to-t from-base via-transparent to-base/60" />
        </div>
        <div className="pointer-events-none absolute -right-24 top-1/3 h-96 w-96 rounded-full bg-brand/20 blur-[140px]" />

        <Container className="relative z-10 pt-24">
          <div className="max-w-2xl">
            <Reveal>
              <Eyebrow>{b.name}</Eyebrow>
            </Reveal>
            <Reveal delay={0.08}>
              <h1 className="font-display mt-5 text-5xl font-bold uppercase leading-[0.95] tracking-tightish sm:text-6xl lg:text-7xl">
                Build Your <span className="text-gradient-gold">Stronger</span> Self
              </h1>
            </Reveal>
            <Reveal delay={0.16}>
              <p className="mt-6 max-w-xl text-lg text-muted">
                Premium strength, conditioning and personal training — world-class coaches,
                state-of-the-art equipment and a community that pushes you further.
              </p>
            </Reveal>
            <Reveal delay={0.24}>
              <div className="mt-8 flex flex-wrap gap-4">
                <Link
                  to="/memberships"
                  className="inline-flex items-center gap-2 rounded-xl bg-brand-gradient px-7 py-3.5 text-sm font-semibold text-[#080808] shadow-gold transition hover:brightness-105"
                >
                  View Memberships <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  to="/classes"
                  className="inline-flex items-center gap-2 rounded-xl border border-border px-7 py-3.5 text-sm font-semibold text-white transition hover:border-brand hover:text-brand"
                >
                  Explore Programs
                </Link>
              </div>
            </Reveal>
            <Reveal delay={0.32}>
              <div className="mt-10 flex items-center gap-2 text-sm text-muted">
                <div className="flex text-brand">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-current" />
                  ))}
                </div>
                Rated 4.9/5 by 2,500+ members
              </div>
            </Reveal>
          </div>
        </Container>
      </section>

      {/* ---------------- Stats ---------------- */}
      <div className="border-y border-border bg-surface">
        <Container className="grid grid-cols-2 gap-6 py-10 lg:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label} className="text-center">
              <div className="font-display text-3xl font-bold text-gradient-gold sm:text-4xl">
                <Counter to={s.value} suffix={s.suffix} />
              </div>
              <p className="mt-1 text-sm text-muted">{s.label}</p>
            </div>
          ))}
        </Container>
      </div>

      {/* ---------------- Why us / highlights ---------------- */}
      <Section>
        <Container>
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <Reveal>
              <div className="relative">
                <Media src={IMAGES.heroAlt} alt="Training floor" className="aspect-[4/5] rounded-3xl" />
                <div className="absolute -bottom-6 -right-4 hidden rounded-2xl border border-border bg-surface p-5 shadow-card sm:block">
                  <div className="flex items-center gap-3">
                    <Trophy className="h-8 w-8 text-brand" />
                    <div>
                      <p className="font-display text-xl font-bold">12+ Years</p>
                      <p className="text-xs text-muted">Transforming lives</p>
                    </div>
                  </div>
                </div>
              </div>
            </Reveal>
            <div>
              <SectionHeading
                eyebrow="Why Karthik Fitness"
                title={<>More than a gym — a <span className="text-gradient-gold">performance lab</span></>}
                subtitle="Every detail is engineered for results: premium equipment, certified coaches, and data-driven programming."
              />
              <div className="mt-8 grid gap-5 sm:grid-cols-2">
                {[
                  { Icon: Dumbbell, title: "Premium Equipment", text: "Commercial-grade machines, free weights and functional rigs." },
                  { Icon: ShieldCheck, title: "Certified Coaches", text: "Internationally certified trainers guiding every rep." },
                  { Icon: Clock, title: "Open 7 Days", text: "Early mornings to late nights — train on your schedule." },
                  { Icon: Star, title: "Proven Results", text: "Thousands of member transformations and counting." },
                ].map(({ Icon, title, text }) => (
                  <Reveal key={title}>
                    <div className="rounded-2xl border border-border bg-surface p-5 transition hover:border-brand/50">
                      <Icon className="h-7 w-7 text-brand" />
                      <h3 className="font-display mt-3 text-lg font-semibold uppercase">{title}</h3>
                      <p className="mt-1.5 text-sm text-muted">{text}</p>
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>
          </div>
        </Container>
      </Section>

      {/* ---------------- Programs ---------------- */}
      <Section className="bg-surface">
        <Container>
          <SectionHeading
            center
            eyebrow="Fitness Programs"
            title={<>Train for <span className="text-gradient-gold">every goal</span></>}
            subtitle="From raw strength to mobility and recovery — pick the path that matches your ambition."
          />
          <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {PROGRAMS.slice(0, 6).map((p, i) => (
              <Reveal key={p.title} delay={i * 0.06}>
                <Link to="/classes" className="group block overflow-hidden rounded-2xl border border-border bg-base">
                  <Media src={p.image} alt={p.title} className="aspect-[16/10]" />
                  <div className="p-5">
                    <h3 className="font-display text-xl font-bold uppercase group-hover:text-brand">{p.title}</h3>
                    <p className="mt-2 text-sm text-muted">{p.blurb}</p>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
          <div className="mt-10 text-center">
            <Link to="/classes" className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:gap-3 transition-all">
              View all programs <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </Container>
      </Section>

      {/* ---------------- Trainers ---------------- */}
      <Section>
        <Container>
          <SectionHeading
            center
            eyebrow="Expert Coaches"
            title={<>Meet your <span className="text-gradient-gold">trainers</span></>}
            subtitle="Certified professionals dedicated to coaching you safely to your goals."
          />
          <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {trainers.map((t, i) => (
              <Reveal key={`${t.name}-${i}`} delay={i * 0.06}>
                <div className="group overflow-hidden rounded-2xl border border-border bg-surface">
                  <Media src={t.photo} alt={t.name} className="aspect-[3/4]" />
                  <div className="p-5">
                    <h3 className="font-display text-lg font-bold uppercase">{t.name}</h3>
                    <p className="text-sm text-brand">{t.specialization}</p>
                    {t.bio && <p className="mt-2 line-clamp-2 text-xs text-muted">{t.bio}</p>}
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* ---------------- Testimonials ---------------- */}
      <Section className="bg-surface">
        <Container>
          <SectionHeading
            center
            eyebrow="Success Stories"
            title={<>What our <span className="text-gradient-gold">members</span> say</>}
          />
          <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-3">
            {TESTIMONIALS.map((t, i) => (
              <Reveal key={t.name} delay={i * 0.08}>
                <figure className="flex h-full flex-col rounded-2xl border border-border bg-base p-7">
                  <div className="flex text-brand">
                    {Array.from({ length: 5 }).map((_, k) => (
                      <Star key={k} className="h-4 w-4 fill-current" />
                    ))}
                  </div>
                  <blockquote className="mt-4 flex-1 text-white/90">“{t.quote}”</blockquote>
                  <figcaption className="mt-5">
                    <p className="font-semibold">{t.name}</p>
                    <p className="text-sm text-muted">{t.role}</p>
                  </figcaption>
                </figure>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* ---------------- Pricing ---------------- */}
      <Section id="pricing">
        <Container>
          <SectionHeading
            center
            eyebrow="Membership Plans"
            title={<>Invest in <span className="text-gradient-gold">yourself</span></>}
            subtitle="Transparent pricing, no hidden fees. Live plans straight from our system."
          />
          <div className="mt-12">
            <MembershipPack />
          </div>
        </Container>
      </Section>

      {/* ---------------- FAQ ---------------- */}
      <Section className="bg-surface">
        <Container>
          <SectionHeading center eyebrow="FAQ" title="Questions, answered" />
          <div className="mt-12">
            <FaqAccordion />
          </div>
        </Container>
      </Section>

      {/* ---------------- CTA ---------------- */}
      <section className="relative overflow-hidden">
        <img src={IMAGES.cta} alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-base/85" />
        <Container className="relative z-10 py-20 text-center">
          <Reveal>
            <h2 className="font-display text-4xl font-bold uppercase leading-tight sm:text-5xl">
              Your transformation <span className="text-gradient-gold">starts today</span>
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-muted">
              Join {b.name} and train in a space built for serious results.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <Link to="/memberships" className="rounded-xl bg-brand-gradient px-8 py-3.5 text-sm font-semibold text-[#080808] shadow-gold transition hover:brightness-105">
                Become a Member
              </Link>
              <Link to="/contact" className="rounded-xl border border-border px-8 py-3.5 text-sm font-semibold text-white transition hover:border-brand hover:text-brand">
                Book a Free Trial
              </Link>
            </div>
          </Reveal>
        </Container>
      </section>
    </>
  );
}
