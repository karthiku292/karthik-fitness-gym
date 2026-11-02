import { Link } from "react-router-dom";
import { IMAGES } from "@/brand";
import { Container, Section, Reveal, Media } from "@/components/public/primitives";
import { PageHero } from "@/components/public/PageHero";
import { PROGRAMS } from "@/features/public/content";

export function ClassesPage() {
  return (
    <>
      <PageHero
        eyebrow="Programs & Classes"
        title={<>Find your <span className="text-gradient-gold">discipline</span></>}
        subtitle="Structured, coach-led programs for every level and every goal."
        image={IMAGES.functional}
      />

      <Section>
        <Container>
          <div className="grid grid-cols-1 gap-8">
            {PROGRAMS.map((p, i) => (
              <Reveal key={p.title} delay={i * 0.04}>
                <div
                  className={`grid items-stretch gap-0 overflow-hidden rounded-2xl border border-border bg-surface lg:grid-cols-2 ${
                    i % 2 === 1 ? "lg:[&>div:first-child]:order-2" : ""
                  }`}
                >
                  <Media src={p.image} alt={p.title} className="aspect-[16/10] lg:aspect-auto" overlay={false} />
                  <div className="flex flex-col justify-center p-8 lg:p-12">
                    <div className="flex flex-wrap gap-2">
                      {p.tags.map((tag) => (
                        <span key={tag} className="rounded-full bg-brand/10 px-3 py-1 text-xs font-medium text-brand">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <h3 className="font-display mt-4 text-2xl font-bold uppercase sm:text-3xl">{p.title}</h3>
                    <p className="mt-3 max-w-md text-muted">{p.blurb}</p>
                    <Link to="/contact" className="mt-6 inline-flex w-fit items-center gap-2 rounded-xl border border-border px-6 py-2.5 text-sm font-semibold text-white transition hover:border-brand hover:text-brand">
                      Try this program
                    </Link>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>
    </>
  );
}
