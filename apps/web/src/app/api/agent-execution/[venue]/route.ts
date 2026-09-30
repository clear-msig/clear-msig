import { withWalletMember } from "@/lib/auth/walletAuthorization";
import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, clientIp } from "@/lib/api/guard";
import { readBoundedBody } from "@/lib/api/body";
import { checkRateLimit } from "@/lib/api/rateLimit";
import {
  normalizeServerExecutionRequest,
  serverAgentExecutionReadiness,
} from "@/lib/agents/serverExecutionAdapters";
import {
  fetchHyperliquidTestnetAccountSnapshot,
  hyperliquidProbeFromSnapshot,
  probeHyperliquidTestnetAccount,
  submitHyperliquidTestnetOrder,
} from "@/lib/agents/serverHyperliquidTestnet";
import { readHyperliquidTestnetExecutorConfig } from "@/lib/agents/hyperliquidTestnetConfig";
import {
  agentServerExecutionStorageMode,
  listAgentServerExecutionRequests,
  recordAgentServerExecutionRequest,
} from "@/lib/agents/serverExecutionRequests";
import {
  hasAgentServerWalletSignedOwnerApproval,
  validateAgentServerExecutionHandoff,
} from "@/features/agents/server/serverState";
import { buildAgentVenueReconciliationSummary } from "@/lib/agents/venueReconciliation";
import type { TradingVenue } from "@/lib/agents/types";

const MAX_BODY_BYTES = 6_000;

interface RouteContext {
  params: Promise<{
    venue: string;
  }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const walletName = request.nextUrl.searchParams.get("walletName")?.trim();
  if (walletName) return withWalletMember(request, walletName, () => getAuthorized(request, context));
  if (request.nextUrl.searchParams.has("agentId")) {
    return NextResponse.json({ error: "Wallet is required for private execution history." }, { status: 400 });
  }
  return getAuthorized(request, context);
}

async function getAuthorized(request: NextRequest, context: RouteContext) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const venue = decodeVenue((await context.params).venue);
  if (!venue) {
    return NextResponse.json({ error: "Unknown trading venue." }, { status: 400 });
  }

  const readiness = serverAgentExecutionReadiness(venue);
  const accountAddress =
    request.nextUrl.searchParams.get("accountAddress")?.trim() || "";
  const accountSnapshot =
    venue === "hyperliquid_testnet" && accountAddress
      ? await fetchHyperliquidTestnetAccountSnapshot({
          accountAddress,
        })
      : null;
  const requests = await readRequestHistory(request);
  return NextResponse.json({
    ok: true,
    readiness,
    accountProbe:
      accountSnapshot != null
        ? hyperliquidProbeFromSnapshot(accountSnapshot)
        : venue === "hyperliquid_testnet" && accountAddress
          ? await probeHyperliquidTestnetAccount({
              accountAddress,
            })
          : null,
    accountSnapshot,
    executorProbe: null,
    storage: agentServerExecutionStorageMode(),
    requests,
    reconciliation: buildAgentVenueReconciliationSummary({
      venue,
      requests,
      accountSnapshot,
    }),
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const limited = await checkRateLimit("agent-execution", clientIp(request), {
    capacity: 10,
    refillPerSec: 1 / 10,
  });
  if (limited) return limited;

  const venue = decodeVenue((await context.params).venue);
  if (!venue) {
    return NextResponse.json({ error: "Unknown trading venue." }, { status: 400 });
  }

  const raw = await readBoundedBody(request, MAX_BODY_BYTES, "Trade request body is too large.");
  if (!raw.ok) return raw.response;

  let body: unknown;
  try {
    body = JSON.parse(raw.text);
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const parsed = normalizeServerExecutionRequest(body);
  if (!parsed.request) {
    return NextResponse.json(
      { error: "Trade request failed validation.", details: parsed.errors },
      { status: 400 },
    );
  }
  if (parsed.request.venue !== venue) {
    return NextResponse.json(
      { error: "Trade request venue does not match the route." },
      { status: 400 },
    );
  }
  const executionRequest = parsed.request;
  return withWalletMember(request, executionRequest.walletName, async () => {
    if (
      !(await hasAgentServerWalletSignedOwnerApproval({
        walletName: executionRequest.walletName,
        agentId: executionRequest.agentId,
        action: "submit_venue_trade",
        targetType: "proposal",
        targetId: executionRequest.proposalId,
      }))
    ) {
      const readiness = serverAgentExecutionReadiness(venue);
      const recorded = await recordAgentServerExecutionRequest({
        request: executionRequest,
        readiness,
        status: "rejected",
        message:
          "Sending a venue trade needs wallet approval before ClearSig can submit it.",
      });
      return NextResponse.json(
        {
          error:
            "Sending a venue trade needs wallet approval before ClearSig can submit it.",
          readiness,
          serverRequest: recorded.record,
          duplicate: recorded.duplicate,
        },
        { status: 409 },
      );
    }

    const readiness = serverAgentExecutionReadiness(venue);
    const gate = await validateAgentServerExecutionHandoff(executionRequest);
    if (!gate.allowed) {
      const recorded = await recordAgentServerExecutionRequest({
        request: executionRequest,
        readiness,
        status: "rejected",
        message: gate.message,
      });
      return NextResponse.json(
        {
          error: gate.message,
          readiness,
          policyGate: gate,
          serverRequest: recorded.record,
          duplicate: recorded.duplicate,
        },
        { status: 409 },
      );
    }

    if (readiness.state === "local_only") {
      const recorded = await recordAgentServerExecutionRequest({
        request: executionRequest,
        readiness,
      });
      return NextResponse.json(
        {
          error: readiness.message,
          readiness,
          serverRequest: recorded.record,
          duplicate: recorded.duplicate,
        },
        { status: 400 },
      );
    }
    if (!readiness.canSubmit) {
      const recorded = await recordAgentServerExecutionRequest({
        request: executionRequest,
        readiness,
      });
      return NextResponse.json(
        {
          error: readiness.message,
          readiness,
          serverRequest: recorded.record,
          duplicate: recorded.duplicate,
        },
        { status: 503 },
      );
    }
    if (venue === "hyperliquid_testnet") {
      const existing = (
        await listAgentServerExecutionRequests(
          executionRequest.walletName,
          executionRequest.agentId,
        )
      ).find(
        (item) =>
          item.request.proposalId === executionRequest.proposalId &&
          item.request.venue === executionRequest.venue &&
          item.status === "submitted",
      );
      if (existing) {
        return NextResponse.json({
          ok: true,
          readiness,
          artifact: existing.artifact,
          serverRequest: existing,
          duplicate: true,
        });
      }
      const configured = readHyperliquidTestnetExecutorConfig();
      if (!configured.config) {
        return NextResponse.json(
          {
            error: "Hyperliquid testnet executor configuration is invalid.",
            details: configured.errors,
            readiness,
          },
          { status: 503 },
        );
      }
      try {
        const artifact = await submitHyperliquidTestnetOrder({
          request: executionRequest,
          config: configured.config,
        });
        const recorded = await recordAgentServerExecutionRequest({
          request: executionRequest,
          readiness,
          status: "submitted",
          message: `Hyperliquid testnet order ${artifact.orderId} was ${artifact.status}.`,
          artifact,
        });
        return NextResponse.json({
          ok: true,
          readiness,
          artifact,
          serverRequest: recorded.record,
          duplicate: recorded.duplicate,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Hyperliquid testnet executor failed.";
        const recorded = await recordAgentServerExecutionRequest({
          request: executionRequest,
          readiness,
          status: "adapter_error",
          message,
        });
        return NextResponse.json(
          {
            error: message,
            readiness,
            serverRequest: recorded.record,
            duplicate: recorded.duplicate,
          },
          { status: 502 },
        );
      }
    }

    const recorded = await recordAgentServerExecutionRequest({
      request: executionRequest,
      readiness,
    });
    return NextResponse.json(
      {
        error: "Server trading adapter is not connected to the exchange yet.",
        readiness,
        serverRequest: recorded.record,
        duplicate: recorded.duplicate,
      },
      { status: 501 },
    );
  });
}

function decodeVenue(value: string): TradingVenue | null {
  try {
    const decoded = decodeURIComponent(value);
    if (
      decoded === "mock_perps" ||
      decoded === "bulktrade_mock" ||
      decoded === "hyperliquid_testnet"
    ) {
      return decoded;
    }
  } catch {
    return null;
  }
  return null;
}

async function readRequestHistory(request: NextRequest) {
  const walletName = request.nextUrl.searchParams.get("walletName")?.trim();
  const agentId = request.nextUrl.searchParams.get("agentId")?.trim();
  if (!walletName || !agentId) return [];
  return listAgentServerExecutionRequests(walletName, agentId);
}
