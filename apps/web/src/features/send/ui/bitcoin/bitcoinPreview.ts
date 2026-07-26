import type { SignPayloadDetail } from "@/components/retail/SignPayloadPreview";
import { formatSats, type EsploraUtxo } from "@/lib/chain/btc";

export function buildBtcPreviewDetails(args: {
  walletDisplay: string;
  destination: string;
  amountBtc: string;
  selectedUtxo: EsploraUtxo | null;
  effectiveFeeSats: bigint | null;
  changeSats: bigint | null;
  note: string;
  approvalThreshold: number;
  timelockSeconds: number;
}): SignPayloadDetail[] {
  const details: SignPayloadDetail[] = [
    { label: "From wallet", value: args.walletDisplay },
    { label: "Network", value: "Bitcoin" },
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
  ];
  const destination = args.destination.trim();
  if (destination) {
    details.push({
      label: "Recipient address",
      value: shortBtcAddress(destination),
      emphasis: "mono",
    });
  }
  if (args.amountBtc.trim()) {
    details.push({
      label: "Amount",
      value: `${args.amountBtc.trim()} BTC`,
      emphasis: "amount",
    });
  }
  if (args.selectedUtxo && args.effectiveFeeSats !== null) {
    details.push({
      label: "Network fee",
      value: `${formatSats(args.effectiveFeeSats)} BTC`,
    });
    if (args.changeSats !== null && args.changeSats > 0n) {
      details.push({
        label: "Change",
        value: `${formatSats(args.changeSats)} BTC back to this wallet`,
      });
    }
  }
  if (args.note.trim()) {
    details.push({
      label: "Note",
      value: args.note.trim(),
    });
  }
  return details;
}

export function shortBtcAddress(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}
