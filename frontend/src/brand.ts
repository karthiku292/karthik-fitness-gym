/**
 * Single source of truth for KARTHIK FITNESS GYM brand identity.
 * Marketing copy/imagery lives here; live business data still comes from the API.
 */
export const BRAND = {
  name: "KARTHIK FITNESS GYM",
  short: "KARTHIK FITNESS",
  monogram: "KF",
  tagline: "BUILD YOUR STRONGER SELF",
  // Slug of the gym/tenant in the backend (used by public endpoints).
  gymSlug: "my-gym",
  email: "hello@karthikfitness.com",
  phone: "+91 98765 43210",
  address: "3rd Floor, Fitness Avenue, Hyderabad, India",
  hours: "Mon–Sat 5:00 AM – 10:00 PM · Sun 6:00 AM – 2:00 PM",
  socials: {
    instagram: "https://instagram.com",
    facebook: "https://facebook.com",
    youtube: "https://youtube.com",
    x: "https://x.com",
  },
  nav: [
    { label: "Home", to: "/" },
    { label: "Memberships", to: "/memberships" },
    { label: "Trainers", to: "/trainers" },
    { label: "Classes", to: "/classes" },
    { label: "Exercises", to: "/exercises" },
    { label: "About", to: "/about" },
    { label: "Contact", to: "/contact" },
  ],
} as const;

/** Unsplash fitness imagery (swap for your own shoot anytime). */
export const IMAGES = {
  hero: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=1600&q=80",
  heroAlt: "https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=1400&q=80",
  strength: "https://images.unsplash.com/photo-1532384748853-8f54a8f476e2?auto=format&fit=crop&w=900&q=80",
  weightloss: "https://images.unsplash.com/photo-1540497077202-7c8a3999166f?auto=format&fit=crop&w=900&q=80",
  muscle: "https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?auto=format&fit=crop&w=900&q=80",
  personal: "https://images.unsplash.com/photo-1549060279-7e168fcee0c2?auto=format&fit=crop&w=900&q=80",
  cardio: "https://images.unsplash.com/photo-1538805060514-97d9cc17730c?auto=format&fit=crop&w=900&q=80",
  functional: "https://images.unsplash.com/photo-1526506118085-60ce8714f8c5?auto=format&fit=crop&w=900&q=80",
  yoga: "https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?auto=format&fit=crop&w=900&q=80",
  facility1: "https://images.unsplash.com/photo-1637666062717-1c6bcfa4a4df?auto=format&fit=crop&w=800&q=80",
  facility2: "https://images.unsplash.com/photo-1558611848-73f7eb4001a1?auto=format&fit=crop&w=800&q=80",
  facility3: "https://images.unsplash.com/photo-1623874514711-0f321325f318?auto=format&fit=crop&w=800&q=80",
  facility4: "https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=800&q=80",
  trainer1: "https://images.unsplash.com/photo-1583454110551-21f2fa2afe61?auto=format&fit=crop&w=600&q=80",
  trainer2: "https://images.unsplash.com/photo-1594381898411-846e7d193883?auto=format&fit=crop&w=600&q=80",
  trainer3: "https://images.unsplash.com/photo-1567013127542-490d757e51fc?auto=format&fit=crop&w=600&q=80",
  trainer4: "https://images.unsplash.com/photo-1609899537878-88d5ba429bdf?auto=format&fit=crop&w=600&q=80",
  cta: "https://images.unsplash.com/photo-1605296867304-46d5465a13f1?auto=format&fit=crop&w=1600&q=80",
} as const;
