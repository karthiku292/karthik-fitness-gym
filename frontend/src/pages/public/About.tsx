import { Target, Heart, Sparkles } from "lucide-react";
import { BRAND, IMAGES } from "@/brand";
import { Container, Section, SectionHeading, Reveal, Counter, Media } from "@/components/public/primitives";
import { PageHero } from "@/components/public/PageHero";
import { STATS } from "@/features/public/content";

const GALLERY = [IMAGES.facility1, IMAGES.facility2, IMAGES.facility3, IMAGES.facility4];

const VALUES = [
  { Icon: Target, title: "Results-Driven", text: "Every program is built around measurable progress and real outcomes." },
  { Icon: Heart, title: "Member-First", text: "Your goals, safety and experience guide every decision we make." },
  { Icon: Sparkles, title: "Premium Standards", text: "Immaculate facilities and equipment, maintained to the highest standard." },
];

export function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="About Us"
        title={<>The home of <span className="text-gradient-gold">serious fitness</span></>}
        subtitle={`${BRAND.name} is where ambition meets expertise.`}
        image={IMAGES.facility2}
      />

      <Section>
        <Container>
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <Reveal>
              <Media src={IMAGES.heroAlt} alt="Our gym" className="aspect-[4/3] rounded-3xl" />
            </Reveal>
            <div>
              <SectionHeading
                eyebrow="Our Story"
                title={<>Built for those who <span className="text-gradient-gold">refuse average</span></>}
                subtitle={`For over a decade, ${BRAND.name} has helped thousands transform their bodies and mindset. We combine premium facilities with science-backed coaching to deliver results that last.`}
              />
              <p className="mt-5 text-muted">
                We believe fitness is a lifelong investment. That's why we obsess over coaching quality,
                equipment, cleanliness and the community that keeps you coming back.
              </p>
            </div>
          </div>
        </Container>
      </Section>

      <div className="border-y border-border bg-surface">
        <Container className="grid grid-cols-2 gap-6 py-12 lg:grid-cols-4">
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

      <Section>
        <Container>
          <SectionHeading center eyebrow="Our Values" title="What we stand for" />
          <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
            {VALUES.map(({ Icon, title, text }, i) => (
              <Reveal key={title} delay={i * 0.08}>
                <div className="rounded-2xl border border-border bg-surface p-7 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand/10 text-brand">
                    <Icon className="h-6 w-6" />
                  </div>
                  <h3 className="font-display mt-4 text-lg font-semibold uppercase">{title}</h3>
                  <p className="mt-2 text-sm text-muted">{text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      <Section className="bg-surface">
        <Container>
          <SectionHeading center eyebrow="Facilities" title="Step inside" />
          <div className="mt-12 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {GALLERY.map((src, i) => (
              <Reveal key={i} delay={i * 0.06}>
                <Media src={src} alt={`Facility ${i + 1}`} className="aspect-square rounded-2xl" overlay={false} />
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>
    </>
  );
}
