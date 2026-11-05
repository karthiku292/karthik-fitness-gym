import { Link } from "react-router-dom";
import { Dumbbell, Instagram, Facebook, Youtube, Mail, Phone, MapPin } from "lucide-react";
import { BRAND } from "@/brand";
import { useBranding } from "@/lib/branding";
import { Container } from "./primitives";

export function PublicFooter() {
  const b = useBranding();
  return (
    <footer className="border-t border-border bg-surface">
      <Container className="py-14">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-4">
          <div className="md:col-span-1">
            <Link to="/" className="flex items-center gap-2.5">
              {b.logoUrl ? (
                <img src={b.logoUrl} alt={b.name} className="h-9 w-9 rounded-lg object-cover" />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-gradient text-[#080808]">
                  <Dumbbell className="h-5 w-5" />
                </span>
              )}
              <span className="font-display text-lg font-bold uppercase">{b.short}</span>
            </Link>
            <p className="mt-4 max-w-xs text-sm text-muted">{b.tagline}. Train with intent, recover with science, and transform with community.</p>
            <div className="mt-5 flex gap-3">
              {[
                { Icon: Instagram, href: b.socials.instagram ?? BRAND.socials.instagram },
                { Icon: Facebook, href: b.socials.facebook ?? BRAND.socials.facebook },
                { Icon: Youtube, href: b.socials.youtube ?? BRAND.socials.youtube },
              ].map(({ Icon, href }, i) => (
                <a
                  key={i}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted transition hover:border-brand hover:text-brand"
                >
                  <Icon className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>

          <div>
            <h4 className="font-display text-sm font-semibold uppercase tracking-wide text-white">Explore</h4>
            <ul className="mt-4 space-y-2.5">
              {BRAND.nav.map((item) => (
                <li key={item.to}>
                  <Link to={item.to} className="text-sm text-muted transition hover:text-brand">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="font-display text-sm font-semibold uppercase tracking-wide text-white">Programs</h4>
            <ul className="mt-4 space-y-2.5">
              {["Strength Training", "Weight Loss", "Muscle Building", "Personal Training", "Yoga & Flexibility"].map((p) => (
                <li key={p}>
                  <Link to="/classes" className="text-sm text-muted transition hover:text-brand">{p}</Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="font-display text-sm font-semibold uppercase tracking-wide text-white">Get in touch</h4>
            <ul className="mt-4 space-y-3 text-sm text-muted">
              <li className="flex items-start gap-3"><MapPin className="mt-0.5 h-4 w-4 text-brand" /> {b.address}</li>
              <li className="flex items-center gap-3"><Phone className="h-4 w-4 text-brand" /> <a href={`tel:${b.phone}`} className="hover:text-brand">{b.phone}</a></li>
              <li className="flex items-center gap-3"><Mail className="h-4 w-4 text-brand" /> <a href={`mailto:${b.email}`} className="hover:text-brand">{b.email}</a></li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-border pt-6 text-sm text-muted sm:flex-row">
          <p>© {new Date().getFullYear()} {b.name}. All rights reserved.</p>
          <p>{b.hours}</p>
        </div>
      </Container>
    </footer>
  );
}
