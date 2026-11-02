import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { clsx } from "clsx";
import { FAQS } from "@/features/public/content";

export function FaqAccordion() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="mx-auto max-w-3xl divide-y divide-border rounded-2xl border border-border bg-surface">
      {FAQS.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={i}>
            <button
              onClick={() => setOpen(isOpen ? null : i)}
              className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
              aria-expanded={isOpen}
            >
              <span className="font-medium text-white">{item.q}</span>
              <ChevronDown
                className={clsx("h-5 w-5 shrink-0 text-brand transition-transform", isOpen && "rotate-180")}
              />
            </button>
            <div
              className={clsx(
                "grid overflow-hidden px-6 transition-all duration-300",
                isOpen ? "grid-rows-[1fr] pb-5" : "grid-rows-[0fr]"
              )}
            >
              <div className="overflow-hidden text-sm leading-relaxed text-muted">{item.a}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
