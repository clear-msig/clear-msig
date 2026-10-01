import { decimalToRaw } from "./escrowExecution";

export function validateRecordedEscrowAmounts(
  funded: string,
  milestone: string,
  decimals: number,
): void {
  const fundedRaw = BigInt(decimalToRaw(funded, decimals));
  const milestoneRaw = BigInt(decimalToRaw(milestone, decimals));
  if (fundedRaw <= 0n || milestoneRaw <= 0n)
    throw new Error("Enter positive recorded escrow amounts.");
  if (milestoneRaw > fundedRaw)
    throw new Error("Milestone exceeds the recorded funding amount.");
}
