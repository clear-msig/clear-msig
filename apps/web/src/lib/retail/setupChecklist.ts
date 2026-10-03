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
  memberCount: number;
  approvalThreshold: number;
  timelockSeconds: number;
  pendingTeammates: number;
}

export function buildSetupChecklist(input: SetupChecklistInput): SetupStep[] {
  const base = input.walletPath;
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
      href: `${base}/members/add`,
      done: hasTeam && input.pendingTeammates === 0,
    },
    {
      id: "threshold",
      title: "Require more than one approval",
      detail: hasTeam
        ? `Currently ${input.approvalThreshold} of ${input.memberCount} must approve.`
        : "Available once a second approver has joined.",
      href: `${base}/policy`,
      done: hasTeam && input.approvalThreshold >= 2,
    },
    {
      id: "delay",
      title: "Add a cooling-off delay",
      detail:
        input.timelockSeconds > 0
          ? "Approved requests wait before they can run."
          : "Optional. Approved requests currently run immediately.",
      href: `${base}/policy`,
      done: input.timelockSeconds > 0,
    },
  ];
}

export function checklistComplete(steps: readonly SetupStep[]): boolean {
  return steps.every((step) => step.done);
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
    window.localStorage.setItem(DISMISS_KEY + walletName, JSON.stringify(["1"]));
  } catch {
    /* ignore */
  }
}
