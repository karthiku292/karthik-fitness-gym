import type { ReactNode } from "react";
import { Container, Eyebrow } from "./primitives";

/** Compact hero banner for interior public pages. */
export function PageHero({
  eyebrow,
  title,
  subtitle,
  image,
}: {
  eyebrow: string;
  title: ReactNode;
  subtitle?: string;
  image: string;
}) {
  return (
    <section className="relative overflow-hidden pt-16">
      <div className="absolute inset-0">
        <img src={image} alt="" className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-base via-base/90 to-base/50" />
        <div className="absolute inset-0 bg-gradient-to-t from-base to-transparent" />
      </div>
      <Container className="relative z-10 py-20 sm:py-28">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="font-display mt-4 max-w-3xl text-4xl font-bold uppercase leading-[0.95] tracking-tightish sm:text-5xl lg:text-6xl">
          {title}
        </h1>
        {subtitle && <p className="mt-5 max-w-xl text-lg text-muted">{subtitle}</p>}
      </Container>
    </section>
  );
}
