import { Card, EmptyState } from "@/components/ui";

/** Honest placeholder for modules scheduled in later phases. */
export function Placeholder({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{title}</h1>
      <Card>
        <EmptyState
          title={`${title} — coming in ${phase}`}
          hint="This module is part of the phased roadmap and will be wired to real backend APIs. No placeholder data is shown here by design."
        />
      </Card>
    </div>
  );
}
