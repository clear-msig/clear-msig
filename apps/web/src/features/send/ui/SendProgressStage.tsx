"use client";

import { BrandLoader } from "@/components/retail/BrandLoader";

export function SendProgressStage({
  primary,
  hint,
  loaderLabel = primary,
}: {
  primary: string;
  hint: string;
  loaderLabel?: string;
  reduceMotion?: boolean;
}) {
  return (
    <section className="flex flex-col items-center text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-raised shadow-card-rest">
        <BrandLoader size={32} label={loaderLabel} />
      </div>
      <p className="mt-5 text-base text-text-strong">{primary}</p>
      <p className="mt-1 text-xs text-text-soft">{hint}</p>
    </section>
  );
}
