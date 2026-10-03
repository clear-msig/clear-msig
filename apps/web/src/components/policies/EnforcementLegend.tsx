import { ShieldCheck } from "lucide-react";
import {
  ENFORCEMENT_LAYER_LABEL,
  ENFORCEMENT_LEGEND,
} from "@/lib/retail/enforcementLegend";

/// Plain-language answer to "what actually stops a bad payment?" for the
/// protection hub. Text only; no status is read from the chain here, so it
/// describes how each rule works, not whether it is currently saved.
export function EnforcementLegend() {
  return (
    <section
      aria-labelledby="enforcement-legend-title"
      className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest sm:p-5"
    >
      <h2
        id="enforcement-legend-title"
        className="flex items-center gap-2 font-display text-base font-semibold text-text-strong"
      >
        <ShieldCheck className="h-4 w-4 text-accent" aria-hidden="true" />
        What stops a payment, and where
      </h2>
      <p className="mt-1 text-sm text-text-soft">
        This app warns you before you sign. Only the on-chain program can
        refuse a request, so a rule counts once it is saved there.
      </p>
      <dl className="mt-3 divide-y divide-border-soft">
        {ENFORCEMENT_LEGEND.map((row) => (
          <div
            key={row.id}
            className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-baseline sm:gap-4"
          >
            <dt className="text-sm font-medium text-text-strong sm:w-44 sm:shrink-0">
              {row.label}
            </dt>
            <dd className="min-w-0 text-sm text-text-soft">
              <span className="mr-2 rounded-full border border-border-soft px-2 py-0.5 text-xs font-medium text-text-strong">
                {ENFORCEMENT_LAYER_LABEL[row.layer]}
              </span>
              {row.detail}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
