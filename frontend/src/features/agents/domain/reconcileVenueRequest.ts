import type {
  AgentVenueRequestRecord,
  AgentVenueRequestReconciliation,
} from "@/lib/agents/clientExecution";
import type { HyperliquidTestnetAccountSnapshot } from "@/lib/agents/serverHyperliquidTestnet";

export function reconcileAgentVenueRequest(
  request: AgentVenueRequestRecord,
  accountSnapshot: HyperliquidTestnetAccountSnapshot | null | undefined,
): AgentVenueRequestReconciliation {
  if (request.status === "adapter_error") {
    return {
      state: "executor_error",
      label: "Executor error",
      message: request.message ?? "The protected executor could not place this request.",
    };
  }
  if (request.status !== "submitted") {
    return {
      state: "not_submitted",
      label: "Not submitted",
      message: request.message ?? "ClearSig has not submitted this request to the venue.",
    };
  }
  if (
    !accountSnapshot ||
    accountSnapshot.state === "missing_address" ||
    accountSnapshot.state === "unavailable"
  ) {
    return {
      state: "waiting_for_account",
      label: "Checking venue",
      message: accountSnapshot?.message ?? "ClearSig is waiting for the venue account state.",
    };
  }
  const market = request.request.market?.toUpperCase();
  const side = request.request.side;
  const matchingPosition = accountSnapshot.positions.find(
    (position) =>
      position.market.toUpperCase() === market && (!side || position.side === side),
  );
  if (matchingPosition) {
    return {
      state: "open_on_venue",
      label: "Open on venue",
      message: `${matchingPosition.market} ${matchingPosition.side} is open on Hyperliquid with ${formatSignedUsd(matchingPosition.unrealizedPnlUsd ?? "0")} live P/L.`,
    };
  }
  if (request.artifact?.orderId?.trim()) {
    return {
      state: "not_found",
      label: "Not found",
      message:
        "ClearSig has an exchange order ID for this request, but no matching Hyperliquid position is open now.",
    };
  }
  return {
    state: "submitted",
    label: "Submitted",
    message:
      "ClearSig submitted this request. Waiting for the next account snapshot to confirm whether it opened.",
  };
}

function formatSignedUsd(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) return "$0";
  return `${parsed > 0 ? "+" : "-"}$${Math.abs(parsed).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })}`;
}
