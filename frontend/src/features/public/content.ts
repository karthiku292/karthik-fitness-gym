import { IMAGES } from "@/brand";

/**
 * Editorial marketing content for the public site (programs, trainers,
 * testimonials, FAQs). This is brand/marketing copy, not live business data.
 */

export interface Program {
  title: string;
  blurb: string;
  image: string;
  tags: string[];
}

export const PROGRAMS: Program[] = [
  {
    title: "Strength Training",
    blurb: "Progressive barbell and compound work to build raw, functional strength safely.",
    image: IMAGES.strength,
    tags: ["Barbell", "Progressive Overload"],
  },
  {
    title: "Weight Loss",
    blurb: "Metabolic conditioning and coaching to drop fat and keep it off for good.",
    image: IMAGES.weightloss,
    tags: ["HIIT", "Nutrition"],
  },
  {
    title: "Muscle Building",
    blurb: "Hypertrophy-focused splits engineered for lean mass and definition.",
    image: IMAGES.muscle,
    tags: ["Hypertrophy", "Splits"],
  },
  {
    title: "Personal Training",
    blurb: "One-on-one coaching tailored to your body, goals and schedule.",
    image: IMAGES.personal,
    tags: ["1-on-1", "Custom Plan"],
  },
  {
    title: "Cardio Training",
    blurb: "Heart-rate zone training on premium equipment for endurance and health.",
    image: IMAGES.cardio,
    tags: ["Endurance", "Zone 2"],
  },
  {
    title: "Functional Training",
    blurb: "Kettlebells, sleds and mobility for athletic, real-world capability.",
    image: IMAGES.functional,
    tags: ["Mobility", "Athletic"],
  },
  {
    title: "Yoga & Flexibility",
    blurb: "Guided flows to improve range of motion, balance and recovery.",
    image: IMAGES.yoga,
    tags: ["Recovery", "Balance"],
  },
];

export interface TrainerProfile {
  name: string;
  specialization: string;
  experience: string;
  certifications: string[];
  bio: string;
  image: string;
}

export const TRAINERS: TrainerProfile[] = [
  {
    name: "Arjun Mehta",
    specialization: "Strength & Conditioning",
    experience: "10+ years",
    certifications: ["NSCA-CSCS", "ISSA"],
    bio: "Former national powerlifter helping members build serious strength with bulletproof technique.",
    image: IMAGES.trainer1,
  },
  {
    name: "Priya Nair",
    specialization: "Fat Loss & Nutrition",
    experience: "8 years",
    certifications: ["Precision Nutrition L2", "ACE"],
    bio: "Turns sustainable nutrition into results, specialising in body recomposition.",
    image: IMAGES.trainer2,
  },
  {
    name: "Rohan Das",
    specialization: "Hypertrophy & Bodybuilding",
    experience: "12 years",
    certifications: ["IFBB Pro Coach", "NASM-CPT"],
    bio: "Competition prep coach obsessed with the details that build award-winning physiques.",
    image: IMAGES.trainer3,
  },
  {
    name: "Sana Kapoor",
    specialization: "Yoga & Mobility",
    experience: "9 years",
    certifications: ["RYT-500", "FRC Mobility"],
    bio: "Blends traditional yoga with modern mobility science for resilient, pain-free movement.",
    image: IMAGES.trainer4,
  },
];

export interface Testimonial {
  name: string;
  role: string;
  quote: string;
}

export const TESTIMONIALS: Testimonial[] = [
  {
    name: "Vikram S.",
    role: "Member · 2 years",
    quote: "Lost 18 kg and gained confidence I never had. The coaches genuinely care about your progress.",
  },
  {
    name: "Anita R.",
    role: "Member · 1 year",
    quote: "The facility is spotless and premium. It feels like a luxury club, not just a gym.",
  },
  {
    name: "Karthik P.",
    role: "Member · 3 years",
    quote: "Personal training here changed my life. Structured plans, real accountability, real results.",
  },
];

export interface Faq {
  q: string;
  a: string;
}

export const FAQS: Faq[] = [
  {
    q: "Do you offer a trial session?",
    a: "Yes. Reach out via the contact page and we'll arrange a complimentary walkthrough and trial workout.",
  },
  {
    q: "Can I freeze or pause my membership?",
    a: "Active members can request a pause with admin approval; your validity is extended by the paused duration.",
  },
  {
    q: "Are personal trainers included?",
    a: "Group classes and floor guidance are included. Dedicated 1-on-1 personal training is available as an add-on.",
  },
  {
    q: "What are your operating hours?",
    a: "We are open Monday to Saturday 5:00 AM – 10:00 PM, and Sunday 6:00 AM – 2:00 PM.",
  },
  {
    q: "How do I pay for my membership?",
    a: "We accept cash, UPI and card at the front desk. You'll receive a receipt and digital confirmation for every payment.",
  },
];

export const STATS = [
  { value: 2500, suffix: "+", label: "Active Members" },
  { value: 25, suffix: "+", label: "Expert Trainers" },
  { value: 40, suffix: "+", label: "Weekly Classes" },
  { value: 12, suffix: "", label: "Years of Excellence" },
];
