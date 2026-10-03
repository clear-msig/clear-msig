"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Circle, X } from "lucide-react";
import {
  buildSetupChecklist,
  checklistComplete,
  dismissChecklist,
  isChecklistDismissed,
  readPendingTeammates,
} from "@/lib/retail/setupChecklist";

interface TeamSetupChecklistProps {
  walletName: string;
  memberAddresses: readonly string[];
  approvalThreshold: number;
  timelockSeconds: number;
}

/// Guides a freshly created 1-of-1 wallet toward a real shared setup.
/// Hidden once every step is done or the owner dismisses it.
export function TeamSetupChecklist({
  walletName,
  memberAddresses,
  approvalThreshold,
  timelockSeconds,
}: TeamSetupChecklistProps) {
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    setDismissed(isChecklistDismissed(walletName));
  }, [walletName]);

  const steps = useMemo(
    () =>
      buildSetupChecklist({
        walletPath: `/app/wallet/${encodeURIComponent(walletName)}`,
        memberCount: memberAddresses.length,
        approvalThreshold,
        timelockSeconds,
        pendingTeammates: readPendingTeammates(walletName, memberAddresses)
          .length,
      }),
    [walletName, memberAddresses, approvalThreshold, timelockSeconds],
  );

  if (dismissed || checklistComplete(steps)) return null;
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <section
      aria-labelledby="setup-checklist-title"
      className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest sm:p-5"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2
            id="setup-checklist-title"
            className="font-display text-base font-semibold text-text-strong"
          >
            Finish setting up your shared wallet
          </h2>
          <p className="mt-0.5 text-sm text-text-soft">
            {doneCount} of {steps.length} done. Until then, one person can
            approve every payment.
          </p>
        </div>
        <button
          type="button"
          aria-label="Hide setup checklist"
          onClick={() => {
            dismissChecklist(walletName);
            setDismissed(true);
          }}
          className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-full text-text-soft hover:text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>
      <ol className="mt-3 flex flex-col divide-y divide-border-soft">
        {steps.map((step) => (
          <li key={step.id}>
            <Link
              href={step.href}
              className="flex min-h-tap items-center gap-3 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {step.done ? (
                <Check className="h-4 w-4 text-accent" aria-label="Done" />
              ) : (
                <Circle
                  className="h-4 w-4 text-text-soft"
                  aria-label="Not done"
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-text-strong">
                  {step.title}
                </span>
                <span className="block text-xs text-text-soft">
                  {step.detail}
                </span>
              </span>
              <ArrowRight
                className="h-4 w-4 text-text-soft"
                aria-hidden="true"
              />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
