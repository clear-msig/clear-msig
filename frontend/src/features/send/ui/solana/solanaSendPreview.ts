import type { SignPayloadDetail } from "@/components/retail/SignPayloadPreview";
import {
  formatAmount,
  type ResolvedSolanaRecipient,
} from "@/features/send/domain/solanaSend";
import { useWalletBudgetUsage } from "@/lib/hooks/useWalletBudgetUsage";
import { shortAddress } from "@/lib/retail/contacts";
import { formatUsd } from "@/lib/retail/priceConversion";
import { toDisplayName } from "@/lib/retail/walletNames";

type ResolvedRecipient = ResolvedSolanaRecipient;

interface SendPreviewArgs {
  walletName: string;
  amount: string;
  amountValid: boolean;
  resolved: ResolvedRecipient;
  pendingUsd: number;
  budgetUsage: ReturnType<typeof useWalletBudgetUsage>;
  approvalThreshold: number;
  timelockSeconds: number;
  feeReserveLamports: bigint;
}
export function buildSendPreviewDetails(args: SendPreviewArgs): SignPayloadDetail[] {
  const { walletName, amount, amountValid, resolved, pendingUsd, budgetUsage } = args;
  const details: SignPayloadDetail[] = [
    { label: "From wallet", value: toDisplayName(walletName) || "your wallet" },
    { label: "Chain", value: "Solana" },
    {
      label: "Approval threshold",
      value: `${args.approvalThreshold} ${args.approvalThreshold === 1 ? "approval" : "approvals"}`,
    },
    {
      label: "Timelock",
      value:
        args.timelockSeconds > 0
          ? `${args.timelockSeconds} seconds after approval`
          : "Immediately after approval",
    },
    {
      label: "Network fee",
      value: `${formatAmount(String(Number(args.feeReserveLamports) / 1_000_000_000))} SOL reserved`,
    },
  ];
  // Always surface the destination address - even for contact-resolved
  // sends. Without this, an attacker who tampers localStorage to swap
  // a contact's address (XSS, malicious extension, shared device) can
  // trick the user into signing "Send 5 SOL to Sarah" while the bytes
  // route to attacker. Showing the abbreviated address gives the user
  // a chance to spot the mismatch before signing.
  if (
    resolved.kind === "address" ||
    resolved.kind === "contact" ||
    resolved.kind === "sns"
  ) {
    const addr =
      resolved.kind === "contact"
        ? resolved.contact.address
        : resolved.address;
    details.push({
      label: "Recipient address",
      value: shortAddress(addr),
      emphasis: "mono",
    });
    if (resolved.kind === "sns") {
      details.push({ label: "SNS name", value: resolved.name });
    }
  }
  if (amountValid) {
    details.push({
      label: "Amount",
      value: `${formatAmount(amount)} SOL`,
      emphasis: "amount",
    });
  }

  // Policy-impact rows. Only render when the user has set the cap
  // they affect; otherwise the detail row would be noise.
  const sol = budgetUsage.perChain.find((c) => c.ticker === "SOL");
  if (amountValid && sol && sol.cap !== null && pendingUsd > 0) {
    const after = sol.spentUsd + pendingUsd;
    details.push({
      label: "Solana / week",
      value: `${formatUsd(after)} of ${formatUsd(sol.cap)}`,
    });
  }
  const cap = budgetUsage.budget?.weeklyUsd ?? null;
  if (amountValid && cap !== null && cap > 0 && pendingUsd > 0) {
    const after = budgetUsage.spentUsd + pendingUsd;
    details.push({
      label: "Wallet / week",
      value: `${formatUsd(after)} of ${formatUsd(cap)}`,
    });
  }
  return details;
}

export function buildSendPreviewWarning(args: {
  resolved: ResolvedRecipient;
  pendingUsd: number;
  budgetUsage: ReturnType<typeof useWalletBudgetUsage>;
}): string | undefined {
  const { resolved, pendingUsd, budgetUsage } = args;

  // Policy breach warnings take priority over recipient warnings;
  // they're more consequential.
  const sol = budgetUsage.perChain.find((c) => c.ticker === "SOL");
  if (sol && sol.cap !== null && sol.spentUsd + pendingUsd > sol.cap) {
    const over = sol.spentUsd + pendingUsd - sol.cap;
    return `This send pushes Solana ${formatUsd(over)} over its ${formatUsd(sol.cap)} weekly cap. Friends still need to approve; the cap is a guide today.`;
  }
  const cap = budgetUsage.budget?.weeklyUsd ?? null;
  if (cap !== null && cap > 0 && budgetUsage.spentUsd + pendingUsd > cap) {
    const over = budgetUsage.spentUsd + pendingUsd - cap;
    return `This send pushes ${budgetUsage.budget ? toDisplayName(budgetUsage.budget.walletName) : "the wallet"} ${formatUsd(over)} over its ${formatUsd(cap)} weekly cap.`;
  }
  if (budgetUsage.velocityHit) {
    return `You have already sent ${budgetUsage.sendsLast24h} times in the last 24 hours, at the per-day limit. This send would go above it.`;
  }

  // Recipient warning - last priority.
  if (resolved.kind === "address") {
    return "You are sending to a raw address (no contact match). Money sent to the wrong address cannot be reversed.";
  }
  return undefined;
}
