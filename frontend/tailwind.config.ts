import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#080808",
        surface: "#151515",
        "surface-2": "#1E1E1E",
        border: "#2A2A2A",
        muted: "#9A9A9A",
        // Metallic gold is the brand accent. Kept under `brand` so existing
        // components (bg-brand-gradient, text-brand, bg-brand/15) re-theme.
        gold: { light: "#F3DFA2", DEFAULT: "#D4AF37", dark: "#BF953F" },
        brand: { light: "#F3DFA2", DEFAULT: "#D4AF37", dark: "#BF953F", 600: "#BF953F" },
        danger: "#EF4444",
        success: "#22C55E",
        warning: "#EAB308",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Oswald", "Inter", "sans-serif"],
      },
      letterSpacing: {
        tightish: "-0.01em",
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg, #F3DFA2 0%, #D4AF37 45%, #BF953F 100%)",
        "gold-gradient": "linear-gradient(135deg, #F3DFA2 0%, #D4AF37 45%, #BF953F 100%)",
        "gold-text": "linear-gradient(135deg, #F3DFA2 0%, #D4AF37 60%, #BF953F 100%)",
      },
      boxShadow: {
        card: "0 2px 16px rgba(0,0,0,0.45)",
        gold: "0 10px 40px -10px rgba(212,175,55,0.45)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(24px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-slow": {
          "0%,100%": { opacity: "0.4" },
          "50%": { opacity: "0.8" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.6s ease forwards",
        "pulse-slow": "pulse-slow 6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
