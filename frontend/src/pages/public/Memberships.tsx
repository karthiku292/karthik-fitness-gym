import { ShieldCheck, Users, Clock, HeartPulse } from "lucide-react";
import { IMAGES } from "@/brand";
import { Container, Section, SectionHeading, Reveal } from "@/components/public/primitives";
import { PageHero } from "@/components/public/PageHero";
import { MembershipPack } from "@/components/public/MembershipPack";
import { FaqAccordion } from "@/components/public/Faq";

const BENEFITS = [
  { Icon: ShieldCheck, title: "Certified Coaching", text: "Guidance from internationally certified trainers." },
  { Icon: Users, title: "Community", text: "Train alongside a motivated, supportive community." },
  { Icon: Clock, title: "Flexible Access", text: "Open 7 days a week with extended hours." },
  { Icon: HeartPulse, title: "Health First", text: "Fitness assessments and progress tracking included." },
];

export function MembershipsPage() {
  return (
    <>
      <PageHero
        eyebrow="Memberships"
        title={<>Choose your <span className="text-gradient-gold">plan</span></>}
        subtitle="Simple, transparent pricing. Every plan unlocks premium facilities and expert coaching."
        image={IMAGES.facility1}
      />

      <Section>
        <Container>
          <MembershipPack />
        </Container>
      </Section>

      <Section className="bg-surface">
        <Container>
          <SectionHeading center eyebrow="Included With Every Plan" title="Premium by default" />
          <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {BENEFITS.map(({ Icon, title, text }, i) => (
              <Reveal key={title} delay={i * 0.06}>
                <div className="rounded-2xl border border-border bg-base p-6 text-center">
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

      <Section>
        <Container>
          <SectionHeading center eyebrow="FAQ" title="Membership questions" />
          <div className="mt-12">
            <FaqAccordion />
          </div>
        </Container>
      </Section>
    </>
  );
}
