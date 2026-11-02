import { Link } from "react-router-dom";
import { Award } from "lucide-react";
import { IMAGES } from "@/brand";
import { Container, Section, Reveal, Media } from "@/components/public/primitives";
import { PageHero } from "@/components/public/PageHero";
import { TRAINERS } from "@/features/public/content";

export function TrainersPage() {
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
            {TRAINERS.map((t, i) => (
              <Reveal key={t.name} delay={i * 0.06}>
                <div className="grid overflow-hidden rounded-2xl border border-border bg-surface sm:grid-cols-[200px_1fr]">
                  <Media src={t.image} alt={t.name} className="aspect-[3/4] sm:aspect-auto" overlay={false} />
                  <div className="p-6">
                    <h3 className="font-display text-xl font-bold uppercase">{t.name}</h3>
                    <p className="text-sm font-medium text-brand">{t.specialization}</p>
                    <p className="mt-3 text-sm text-muted">{t.bio}</p>
                    <div className="mt-4 space-y-2 text-sm">
                      <p className="text-white/80"><span className="text-muted">Experience:</span> {t.experience}</p>
                      <div className="flex flex-wrap gap-2">
                        {t.certifications.map((c) => (
                          <span key={c} className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-3 py-1 text-xs text-brand">
                            <Award className="h-3 w-3" /> {c}
                          </span>
                        ))}
                      </div>
                    </div>
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
