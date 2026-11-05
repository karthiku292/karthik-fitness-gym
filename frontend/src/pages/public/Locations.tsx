import { useEffect, useState } from "react";
import { MapPin, Phone, Clock, Navigation } from "lucide-react";
import { IMAGES } from "@/brand";
import { Container, Section, Reveal } from "@/components/public/primitives";
import { PageHero } from "@/components/public/PageHero";
import { Branch, listPublicBranches } from "@/features/branches/api";

export function LocationsPage() {
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listPublicBranches()
      .then((b) => active && setBranches(b))
      .catch(() => active && setError("Could not load locations"));
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <PageHero
        eyebrow="Our Centers"
        title={<>Find a <span className="text-gradient-gold">branch near you</span></>}
        subtitle="Train at any of our locations with the same premium equipment and coaching."
        image={IMAGES.facility1}
      />

      <Section>
        <Container>
          {error ? (
            <p className="py-16 text-center text-muted">{error}</p>
          ) : branches && branches.length === 0 ? (
            <p className="py-16 text-center text-muted">Locations will be listed here soon. Please contact us for details.</p>
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {(branches ?? []).map((b, i) => (
                <Reveal key={b.id} delay={(i % 3) * 0.06}>
                  <div className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-surface">
                    {b.photo_url && (
                      <div className="aspect-[16/10] overflow-hidden">
                        <img src={b.photo_url} alt={b.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                      </div>
                    )}
                    <div className="flex flex-1 flex-col p-5">
                      <h3 className="font-display text-xl font-bold uppercase">{b.name}</h3>
                      {b.city && <p className="text-sm text-brand">{b.city}</p>}
                      <div className="mt-3 space-y-2 text-sm text-muted">
                        {b.address && <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand" />{b.address}</p>}
                        {b.phone && <p className="flex items-center gap-2"><Phone className="h-4 w-4 text-brand" />{b.phone}</p>}
                        {b.hours && <p className="flex items-center gap-2"><Clock className="h-4 w-4 text-brand" />{b.hours}</p>}
                      </div>
                      {b.map_url && (
                        <a href={b.map_url} target="_blank" rel="noreferrer" className="mt-4 inline-flex w-fit items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-semibold text-white transition hover:border-brand hover:text-brand">
                          <Navigation className="h-4 w-4" /> Get Directions
                        </a>
                      )}
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          )}
        </Container>
      </Section>
    </>
  );
}
