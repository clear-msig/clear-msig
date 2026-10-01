import { hashAgentText } from "@/lib/agents/agentClearSignEncoding";
/** Compare current executor arguments to the exact finalized readable document.
 * This prevents a saved same-kind proposal for another session/trade satisfying UI state.
 */
function field(document: string, label: string): string {
  const lines = document
    .split("\n")
    .filter((line) => line.startsWith(label + ": "));
  if (lines.length !== 1)
    throw new Error(`Canonical ${label} is missing or ambiguous.`);
  return lines[0].slice(label.length + 2);
}
export function assertCanonicalFields(
  document: string,
  expected: Record<string, string>,
): void {
  for (const [label, value] of Object.entries(expected))
    if (field(document, label) !== value)
      throw new Error(`Canonical ${label} differs from the requested action.`);
}
function decimalRaw(value: string, decimals: number): string {
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);
  if (!match || (match[2]?.length ?? 0) > decimals)
    throw new Error("Canonical numeric precision is invalid.");
  return (
    BigInt(match[1]) * 10n ** BigInt(decimals) +
    BigInt((match[2] ?? "").padEnd(decimals, "0"))
  ).toString();
}
export function verifyAgentExecutionDocument(
  kind: number,
  executor: Record<string, unknown>,
  document: string,
): void {
  const equals = (key: string, value: string | number) => {
    if (String(executor[key]) !== String(value))
      throw new Error(`Canonical executor ${key} differs from this request.`);
  };
  const hashed = (key: string, label: string) =>
    equals(key, hashAgentText(field(document, label)));
  hashed("sessionIdHash", "Session");
  if (kind === 9 || kind === 12) {
    hashed("agentIdHash", "Agent");
    hashed("venueHash", "Venue");
    hashed("marketHash", "Market");
    const notional = field(document, "Maximum notional"),
      leverage = field(document, "Maximum leverage");
    if (!notional.endsWith(" USD") || !leverage.endsWith("x"))
      throw new Error("Canonical agent units differ.");
    equals(
      kind === 9 ? "amountRaw" : "maxNotionalRaw",
      decimalRaw(notional.slice(0, -4), 6),
    );
    equals("maxLeverageX100", decimalRaw(leverage.slice(0, -1), 2));
  }
  if (kind === 9) {
    hashed("sideHash", "Side");
    hashed("assetIdHash", "Asset ID");
    hashed("routeHash", "Route");
    equals("riskCheckHash", field(document, "Risk check"));
  }
  if (kind === 12) {
    equals("expiresAt", field(document, "Session expiry (Unix)"));
    const title =
      executor.status === 1
        ? "Grant agent session"
        : executor.status === 2
          ? "Revoke agent session"
          : "unsupported";
    if (!document.includes(`\n\nACTION\n${title}\n\n`))
      throw new Error("Canonical session operation differs.");
  }
  if (kind === 13) {
    equals("maxLossRaw", field(document, "Maximum realized loss (raw)"));
    equals("oraclePolicyHash", field(document, "Oracle policy"));
    const title =
      executor.status === 1
        ? "Set agent risk policy"
        : executor.status === 2
          ? "Pause agent risk policy"
          : "unsupported";
    if (!document.includes(`\n\nACTION\n${title}\n\n`))
      throw new Error("Canonical risk operation differs.");
  }
  if (kind === 14) {
    hashed("executionIdHash", "Execution");
    equals("closedNotionalRaw", field(document, "Closed notional (raw)"));
    equals("pnlAbsRaw", field(document, "Absolute P/L (raw)"));
    equals("settlementSequence", field(document, "Settlement sequence"));
    equals("settlementArtifactHash", field(document, "Settlement artifact"));
    equals("oraclePolicyHash", field(document, "Oracle policy"));
    const outcome = field(document, "Outcome");
    equals(
      "outcome",
      outcome === "profit"
        ? 1
        : outcome === "loss"
          ? 2
          : outcome === "flat"
            ? 3
            : "unsupported",
    );
  }
}
