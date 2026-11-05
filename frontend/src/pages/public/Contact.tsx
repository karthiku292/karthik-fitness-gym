import { FormEvent, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Mail, Phone, MapPin, Clock, Send } from "lucide-react";
import { IMAGES } from "@/brand";
import { useBranding } from "@/lib/branding";
import { Container, Section, Reveal } from "@/components/public/primitives";
import { PageHero } from "@/components/public/PageHero";
import { Input, Button } from "@/components/ui";

export function ContactPage() {
  const [params] = useSearchParams();
  const presetPlan = params.get("plan");
  const b = useBranding();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState(
    presetPlan ? `Hi, I'm interested in the "${presetPlan}" membership plan. Please get in touch.` : ""
  );

  // Functional submission via the visitor's email client (no fake "sent" claim,
  // no backend lead store required).
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const subject = encodeURIComponent(
      presetPlan ? `Membership enquiry: ${presetPlan}` : "General enquiry"
    );
    const body = encodeURIComponent(
      `Name: ${name}\nEmail: ${email}\nPhone: ${phone}\n\n${message}`
    );
    window.location.href = `mailto:${b.email}?subject=${subject}&body=${body}`;
  }

  const contactItems = [
    { Icon: MapPin, label: "Visit", value: b.address },
    { Icon: Phone, label: "Call", value: b.phone, href: `tel:${b.phone}` },
    { Icon: Mail, label: "Email", value: b.email, href: `mailto:${b.email}` },
    { Icon: Clock, label: "Hours", value: b.hours },
  ];

  return (
    <>
      <PageHero
        eyebrow="Contact"
        title={<>Let's <span className="text-gradient-gold">talk fitness</span></>}
        subtitle="Questions about membership, trials or personal training? We're here to help."
        image={IMAGES.facility3}
      />

      <Section>
        <Container>
          <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr]">
            {/* Info */}
            <div className="space-y-5">
              {contactItems.map(({ Icon, label, value, href }) => (
                <Reveal key={label}>
                  <div className="flex items-start gap-4 rounded-2xl border border-border bg-surface p-5">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
                      {href ? (
                        <a href={href} className="font-medium text-white hover:text-brand">{value}</a>
                      ) : (
                        <p className="font-medium text-white">{value}</p>
                      )}
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>

            {/* Form */}
            <Reveal>
              <form onSubmit={onSubmit} className="rounded-2xl border border-border bg-surface p-7">
                <h2 className="font-display text-2xl font-bold uppercase">Send us a message</h2>
                <p className="mt-1 text-sm text-muted">
                  This opens your email app with the details pre-filled.
                </p>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
                  <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
                  <div className="sm:col-span-2">
                    <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1.5 block text-sm font-medium text-muted">Message</label>
                    <textarea
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      rows={5}
                      required
                      className="w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm text-white placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-brand/60"
                      placeholder="How can we help?"
                    />
                  </div>
                </div>
                <Button type="submit" className="mt-5 w-full sm:w-auto">
                  <Send className="h-4 w-4" /> Send Message
                </Button>
              </form>
            </Reveal>
          </div>
        </Container>
      </Section>
    </>
  );
}
