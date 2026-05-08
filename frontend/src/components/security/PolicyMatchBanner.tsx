"use client";

// Compose-time banner that fires when a policy rule matches the
// candidate proposal. Rendered above the SignPayloadPreview on the
// send pages so the user sees WHY the submit button is disabled
// (deny case) or what extra friction is coming (require-* cases).
//
// Three visual modes:
//   - deny                       → red, hard-stop messaging
//   - require-extra-approvers    → amber, "extra signers needed"
//   - require-cooldown           → amber, "extra wait time"
//   - allow                      → quiet green confirmation chip
//
// All forms link to the rule's edit page so an admin who's
// surprised by a fire can tap through and inspect / disable it.

import Link from "next/link";
import { ShieldAlert, ShieldCheck, Clock, Users } from "lucide-react";
import type { RuleEvaluation } from "@/lib/policies/types";

interface Props {
  walletName: string;
  evaluation: RuleEvaluation;
}

export function PolicyMatchBanner({ walletName, evaluation }: Props) {
  if (!evaluation.matched) return null;

  const { ruleName, ruleId, action, reasons } = evaluation;
  const ruleHref = `/app/wallet/${encodeURIComponent(walletName)}/policies/${ruleId}`;

  const matchedReasons = reasons
    .filter((r) => r.matched)
    .map((r) => r.detail)
    .filter((s): s is string => !!s)
    .slice(0, 3);

  if (action === "deny") {
    return (
      <div
        role="alert"
        className="rounded-card border border-rose-500/40 bg-rose-500/[0.06] p-3 text-xs"
      >
        <div className="flex items-start gap-3">
          <ShieldAlert
            className="mt-0.5 h-4 w-4 shrink-0 text-rose-600"
            strokeWidth={2}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-text-strong">
              Blocked by policy: {ruleName}
            </p>
            <p className="mt-1 text-text-soft">
              This send matches a deny rule on this wallet
              {matchedReasons.length > 0
                ? ` (${matchedReasons.join("; ")})`
                : ""}
              . Edit the rule from{" "}
              <Link
                href={ruleHref}
                className="font-medium text-rose-600 hover:text-rose-700"
              >
                Policies
              </Link>{" "}
              to allow it, or pick a different recipient / amount.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (action === "require-extra-approvers") {
    return (
      <div
        role="status"
        className="rounded-card border border-warning/40 bg-warning/[0.06] p-3 text-xs"
      >
        <div className="flex items-start gap-3">
          <Users
            className="mt-0.5 h-4 w-4 shrink-0 text-warning"
            strokeWidth={2}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-text-strong">
              Extra approvers required: {ruleName}
            </p>
            <p className="mt-1 text-text-soft">
              On top of the wallet&rsquo;s usual threshold, this rule
              requires additional signers before the send can execute.
              You can still propose now; the extras get pinged.{" "}
              <Link
                href={ruleHref}
                className="font-medium text-warning hover:text-warning/80"
              >
                See the rule
              </Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (action === "require-cooldown") {
    return (
      <div
        role="status"
        className="rounded-card border border-warning/40 bg-warning/[0.06] p-3 text-xs"
      >
        <div className="flex items-start gap-3">
          <Clock
            className="mt-0.5 h-4 w-4 shrink-0 text-warning"
            strokeWidth={2}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-text-strong">
              Extra cooldown: {ruleName}
            </p>
            <p className="mt-1 text-text-soft">
              This rule adds wait time on top of the wallet&rsquo;s
              timelock before execution.{" "}
              <Link
                href={ruleHref}
                className="font-medium text-warning hover:text-warning/80"
              >
                See the rule
              </Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // action === "allow" — quiet confirmation. Useful when the
  // wallet has an "allowlist + deny everyone else" stack and the
  // user wants visible confirmation that this recipient is on
  // the list.
  return (
    <div className="rounded-card border border-accent/30 bg-accent/[0.06] p-3 text-xs">
      <div className="flex items-start gap-3">
        <ShieldCheck
          className="mt-0.5 h-4 w-4 shrink-0 text-accent"
          strokeWidth={2}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-text-strong">
            Policy match: {ruleName}
          </p>
          <p className="mt-1 text-text-soft">
            This send matches an allow rule. Proceeding with the
            wallet&rsquo;s usual threshold.{" "}
            <Link
              href={ruleHref}
              className="font-medium text-accent hover:text-accent-hover"
            >
              See the rule
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
