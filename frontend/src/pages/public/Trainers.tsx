import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { IMAGES } from "@/brand";
import { Container, Section, Reveal } from "@/components/public/primitives";
import { PageHero } from "@/components/public/PageHero";
import { DisplayTrainer, getDisplayTrainers } from "@/features/trainers/api";

export function TrainersPage() {
  const [trainers, setTrainers] = useState<DisplayTrainer[]>([]);

  useEffect(() => {
    let active = true;
    getDisplayTrainers().then((t) => active && setTrainers(t));
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <PageHero
        eyebrow="Our Team"
        title={<>Coaches who <span className="text-gradient-gold">care</span></>}
        subtitle="Meet the certified professionals who will guide your transformation."
        image={IMAGES.trainer1}
      />

      <Section>
        <Container>
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
            {trainers.map((t, i) => (
              <Reveal key={`${t.name}-${i}`} delay={(i % 2) * 0.06}>
                <div className="grid overflow-hidden rounded-2xl border border-border bg-surface sm:grid-cols-[200px_1fr]">
                  <div className="aspect-[3/4] overflow-hidden bg-surface-2 sm:aspect-auto">
                    {t.photo ? (
                      <img src={t.photo} alt={t.name} loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-4xl font-bold text-brand">
                        {t.name.charAt(0)}
                      </div>
                    )}
                  </div>
                  <div className="p-6">
                    <h3 className="font-display text-xl font-bold uppercase">{t.name}</h3>
                    <p className="text-sm font-medium text-brand">{t.specialization}</p>
                    {t.bio && <p className="mt-3 text-sm text-muted">{t.bio}</p>}
                  </div>
                </div>
              </Reveal>
            ))}
          </div>

          <div className="mt-14 rounded-3xl border border-border bg-surface p-10 text-center">
            <h2 className="font-display text-2xl font-bold uppercase sm:text-3xl">Want 1-on-1 coaching?</h2>
            <p className="mx-auto mt-3 max-w-xl text-muted">
              Pair your membership with personal training for a fully tailored plan and dedicated accountability.
            </p>
            <Link to="/contact" className="mt-6 inline-block rounded-xl bg-brand-gradient px-7 py-3 text-sm font-semibold text-[#080808] shadow-gold transition hover:brightness-105">
              Enquire About Personal Training
            </Link>
          </div>
        </Container>
      </Section>
    </>
  );
}
