import { IntentType } from "@/lib/msig";
import type { IntentWithPda } from "@/lib/chain/intents";

// Post-creation setup checklist.
//
// New wallets are created by one signer with a 1-of-1 approval rule and no
// cooling-off delay (the first setup proposal can only be approved by its
// creator). Everything that makes a wallet "shared" - teammates, a higher
// approval threshold, a delay - is a later governance change. This module
// derives which of those steps are still open from the on-chain intent so
// the wallet page can guide the owner instead of leaving a 1-of-1 wallet
// looking finished.

export type SetupStepId = "teammates" | "threshold" | "delay";

export interface SetupStep {
  id: SetupStepId;
  title: string;
  detail: string;
  href: string;
  done: boolean;
}

export interface SetupChecklistInput {
  walletPath: string;
  intentIndex: number;
  memberCount: number;
  approvalThreshold: number;
  timelockSeconds: number;
  pendingTeammates: number;
}

export function buildSetupChecklist(input: SetupChecklistInput): SetupStep[] {
  const base = input.walletPath;
  const rule = `intent=${input.intentIndex}`;
  const hasTeam = input.memberCount >= 2;
  const teammateDetail =
    input.pendingTeammates > 0
      ? `${input.pendingTeammates} imported signer${input.pendingTeammates === 1 ? "" : "s"} still to add.`
      : "Add the people who should approve payments.";
  return [
    {
      id: "teammates",
      title: "Add teammates",
      detail: teammateDetail,
      href: `${base}/members/add?${rule}`,
      done: hasTeam && input.pendingTeammates === 0,
    },
    {
      id: "threshold",
      title: "Require more than one approval",
      detail: hasTeam
        ? `Currently ${input.approvalThreshold} of ${input.memberCount} must approve.`
        : "Available once a second approver has joined.",
      href: `${base}/policy?${rule}`,
      done: hasTeam && input.approvalThreshold >= 2,
    },
    {
      id: "delay",
      title: "Cooling-off delay (optional)",
      detail:
        input.timelockSeconds > 0
          ? "Approved requests wait before they can run."
          : "Optional. Approved requests currently run immediately.",
      href: `${base}/rules#rule-${input.intentIndex}`,
      done: input.timelockSeconds > 0,
    },
  ];
}

export function checklistComplete(steps: readonly SetupStep[]): boolean {
  return steps.every((step) => step.done || step.id === "delay");
}

const PENDING_KEY = "clear.pending-team.v1:";
const DISMISS_KEY = "clear.setup-checklist-dismissed.v1:";

function readList(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

export function savePendingTeammates(
  walletName: string,
  addresses: readonly string[],
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PENDING_KEY + walletName,
      JSON.stringify([...new Set(addresses)]),
    );
  } catch {
    /* storage unavailable: the checklist just omits the imported count */
  }
}

/// Imported signers that have not yet been added on-chain. Entries that are
/// already members are dropped so the count self-heals after each add.
export function readPendingTeammates(
  walletName: string,
  currentMembers: readonly string[],
): string[] {
  const members = new Set(currentMembers);
  return readList(PENDING_KEY + walletName).filter((a) => !members.has(a));
}

export function isChecklistDismissed(walletName: string): boolean {
  return readList(DISMISS_KEY + walletName).includes("1");
}

export function dismissChecklist(walletName: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      DISMISS_KEY + walletName,
      JSON.stringify(["1"]),
    );
  } catch {
    /* ignore */
  }
}

/** An explicit missing/invalid rule never silently redirects an authority edit. */
export function selectSpendingIntent(
  intents: readonly IntentWithPda[],
  requested: string | null,
) {
  const rules = intents.filter(
    (it) => it.account?.approved && it.account.intentType === IntentType.Custom,
  );
  if (requested === null) return rules[0] ?? null;
  if (!/^(0|[1-9]\d*)$/.test(requested)) return null;
  return (
    rules.find((it) => it.account?.intentIndex === Number(requested)) ?? null
  );
}

export function importedMemberHref(
  walletName: string,
  intentIndex: number,
  address: string,
): string {
  return `/app/wallet/${encodeURIComponent(walletName)}/members/add?intent=${intentIndex}&address=${encodeURIComponent(address)}&role=approver`;
}

export function ruleAuthorityCopy(
  rule: { approvalThreshold: number; approvers: readonly string[] },
  creator: string,
): string {
  const count = rule.approvers.length;
  const creatorOnly =
    count === 1 &&
    rule.approvalThreshold === 1 &&
    rule.approvers[0] === creator;
  return `${rule.approvalThreshold} of ${count} governance approvals required${creatorOnly ? " (creator only)" : ""}. Payment approvers do not automatically have this authority.`;
}
