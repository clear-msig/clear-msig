"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Circle, X } from "lucide-react";
import type { IntentWithPda } from "@/lib/chain/intents";
import { IntentType } from "@/lib/msig";
import {
  buildSetupChecklist,
  checklistComplete,
  dismissChecklist,
  importedMemberHref,
  isChecklistDismissed,
  readPendingTeammates,
  ruleAuthorityCopy,
} from "@/lib/retail/setupChecklist";

export interface TeamSetupChecklistProps {
  walletName: string;
  intents: readonly IntentWithPda[];
  creator: string;
}

export function TeamSetupChecklist({
  walletName,
  intents,
  creator,
}: TeamSetupChecklistProps) {
  const [dismissed, setDismissed] = useState(true);
  const [imported, setImported] = useState<string[]>([]);
  useEffect(() => {
    setDismissed(isChecklistDismissed(walletName));
    setImported(readPendingTeammates(walletName, []));
  }, [walletName, intents]);
  const active = intents.flatMap((it) =>
    it.account?.approved ? [it.account] : [],
  );
  const spending = active.filter((it) => it.intentType === IntentType.Custom);
  const governance = active.filter((it) =>
    (
      [
        IntentType.AddIntent,
        IntentType.RemoveIntent,
        IntentType.UpdateIntent,
      ] as number[]
    ).includes(it.intentType),
  );
  const base = `/app/wallet/${encodeURIComponent(walletName)}`;
  return (
    <section
      aria-labelledby="setup-checklist-title"
      className="min-w-0 rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest sm:p-5"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="setup-checklist-title"
            className="font-display text-base font-semibold text-text-strong"
          >
            Spending rules and change authority
          </h2>
          <p className="mt-1 text-sm text-text-soft">
            Each rule has its own approvers. Adding a person to one rule does
            not add them to other rules or governance.
          </p>
        </div>
        {!dismissed && (
          <button
            type="button"
            aria-label="Hide setup checklist"
            onClick={() => {
              dismissChecklist(walletName);
              setDismissed(true);
            }}
            className="inline-flex min-h-tap min-w-tap shrink-0 items-center justify-center rounded-full text-text-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </header>
      {!dismissed && (
        <div className="mt-4 flex flex-col gap-4">
          {!spending.length && (
            <p className="text-sm text-text-soft">
              No active spending rule.{" "}
              <Link href={`${base}/setup`} className="underline">
                Review rule setup
              </Link>
              .
            </p>
          )}
          {spending.map((rule) => {
            const pending = imported.filter(
              (address) => !rule.approvers.includes(address),
            );
            const steps = buildSetupChecklist({
              walletPath: base,
              intentIndex: rule.intentIndex,
              memberCount: rule.approvers.length,
              approvalThreshold: rule.approvalThreshold,
              timelockSeconds: rule.timelockSeconds,
              pendingTeammates: pending.length,
            });
            return (
              <div
                key={rule.intentIndex}
                className="min-w-0 border-t border-border-soft pt-4"
              >
                <h3 className="font-medium text-text-strong">
                  Spending rule #{rule.intentIndex}
                </h3>
                <p className="mt-1 text-sm text-text-soft">
                  {rule.approvalThreshold} of {rule.approvers.length} approvals.{" "}
                  {rule.approvalThreshold === 1
                    ? "One listed approver can approve requests under this rule."
                    : "Multiple listed approvers are required for this rule."}{" "}
                  {checklistComplete(steps)
                    ? "Shared approval setup is complete; delay is optional."
                    : "Review the remaining setup steps for this rule."}
                </p>
                <details className="mt-2 text-sm text-text-soft">
                  <summary className="min-h-11 cursor-pointer py-3">
                    Approvers for rule #{rule.intentIndex}
                  </summary>
                  {rule.approvers.map((address) => (
                    <p key={address} className="break-all font-mono text-xs">
                      {address}
                    </p>
                  ))}
                </details>
                {!!pending.length && (
                  <div className="mt-2">
                    <p className="text-sm text-text-soft">
                      Imported drafts still to add to this rule. Review the
                      address and role before signing.
                    </p>
                    <ul>
                      {pending.map((address) => (
                        <li key={address}>
                          <Link
                            href={importedMemberHref(
                              walletName,
                              rule.intentIndex,
                              address,
                            )}
                            className="flex min-h-11 items-center gap-2 py-2 text-sm text-text-strong underline"
                          >
                            <span className="min-w-0 flex-1 break-all font-mono text-xs">
                              {address}
                            </span>
                            <span className="shrink-0">Review add</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <ol className="mt-2 divide-y divide-border-soft">
                  {steps.map((step) => (
                    <li key={step.id}>
                      <Link
                        href={step.href}
                        className="flex min-h-tap items-center gap-3 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        {step.done ? (
                          <Check
                            className="h-4 w-4 shrink-0 text-accent"
                            aria-label="Done"
                          />
                        ) : (
                          <Circle
                            className="h-4 w-4 shrink-0 text-text-soft"
                            aria-label={
                              step.id === "delay" ? "Optional" : "Not done"
                            }
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
                          className="h-4 w-4 shrink-0 text-text-soft"
                          aria-hidden="true"
                        />
                      </Link>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-4 border-t border-border-soft pt-4">
        <h3 className="font-medium text-text-strong">Governance authority</h3>
        <p className="mt-1 text-sm text-text-soft">
          The controls above edit spending rules. They do not change who can
          add, remove or update those rules.
        </p>
        {!governance.length && (
          <p className="text-sm text-text-soft">
            Governance authority is unavailable. Do not infer it from spending
            approvers.
          </p>
        )}
        {governance.map((rule) => (
          <details
            key={rule.intentIndex}
            className="mt-2 text-sm text-text-soft"
          >
            <summary className="min-h-11 cursor-pointer py-3">
              {rule.intentType === IntentType.AddIntent
                ? "Add rules (AddIntent)"
                : rule.intentType === IntentType.RemoveIntent
                  ? "Remove rules (RemoveIntent)"
                  : "Change rules (UpdateIntent)"}
              : {rule.approvalThreshold} of {rule.approvers.length}
            </summary>
            <p>{ruleAuthorityCopy(rule, creator)}</p>
            {rule.approvers.map((address) => (
              <p key={address} className="break-all font-mono text-xs">
                {address}
              </p>
            ))}
          </details>
        ))}
      </div>
    </section>
  );
}
