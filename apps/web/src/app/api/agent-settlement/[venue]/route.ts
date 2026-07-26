import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { assertSameOrigin, clientIp } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { readHyperliquidTestnetExecutorConfig } from "@/lib/agents/hyperliquidTestnetConfig";
import {
  listAgentServerExecutionRequests,
  hashAgentServerExecutionArtifact,
  recordAgentServerExecutionSettlement,
  recordAgentServerExecutionSettlementProof,
} from "@/lib/agents/serverExecutionRequests";
import {
  submitHyperliquidTestnetSettlement,
  verifyHyperliquidTestnetSettlementArtifact,
} from "@/lib/agents/serverHyperliquidTestnet";
import { fetchAgentRiskLedger } from "@/lib/agents/agentRiskLedger";
import { decimalToAgentUsdRaw } from "@/lib/agents/agentClearSignEncoding";
import {
  getAgentServerWalletState,
  hasAgentServerWalletSignedOwnerApproval,
} from "@/features/agents/server/serverState";
import { CLEAR_WALLET_PROGRAM_ID, DEFAULT_COMMITMENT, getConnection } from "@/lib/chain/client";
import { parseAnyProposal, ProposalStatus } from "@/lib/msig";
import { fetchWalletByName } from "@/lib/chain/wallets";

const MAX_BODY_BYTES = 2_000;

interface RouteContext {
  params: Promise<{ venue: string }>;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;
  const limited = await checkRateLimit("agent-settlement-proof", clientIp(request), {
    capacity: 12,
    refillPerSec: 1 / 10,
  });
  if (limited) return limited;
  if ((await context.params).venue !== "hyperliquid_testnet") {
    return NextResponse.json({ error: "Unknown settlement venue." }, { status: 400 });
  }
  const body = await readBody(request);
  if (!body.ok) return body.response;
  const walletName = textField(body.value, "walletName");
  const agentId = textField(body.value, "agentId");
  const requestId = textField(body.value, "requestId");
  const proposalAddress = textField(body.value, "proposalAddress");
  const status = textField(body.value, "status");
  const txid = textField(body.value, "txid") || undefined;
  if (!walletName || !agentId || !requestId || !proposalAddress || !isProposalStatus(status)) {
    return NextResponse.json({ error: "Settlement proposal metadata is invalid." }, { status: 400 });
  }
  if (!(await hasAgentServerWalletSignedOwnerApproval({
    walletName,
    agentId,
    action: "close_practice_trade",
    targetType: "execution",
    targetId: requestId,
  }))) {
    return NextResponse.json({ error: "Wallet settlement approval was not found." }, { status: 409 });
  }
  try {
    if (!(await chainConfirmsProposalStatus(proposalAddress, status))) {
      return NextResponse.json({ error: `On-chain proposal is not ${status}.` }, { status: 409 });
    }
  } catch {
    return NextResponse.json(
      { error: "Could not verify settlement proposal state on chain." },
      { status: 503 },
    );
  }
  try {
    const record = await recordAgentServerExecutionSettlementProof({
      walletName,
      agentId,
      requestId,
      proposalAddress,
      status,
      txid,
    });
    return NextResponse.json({ ok: true, serverRequest: record });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Settlement metadata could not be stored." },
      { status: 409 },
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;
  const limited = await checkRateLimit("agent-settlement", clientIp(request), {
    capacity: 6,
    refillPerSec: 1 / 20,
  });
  if (limited) return limited;
  if ((await context.params).venue !== "hyperliquid_testnet") {
    return NextResponse.json({ error: "This venue has no trusted settlement adapter." }, { status: 400 });
  }

  const body = await readBody(request);
  if (!body.ok) return body.response;
  const walletName = textField(body.value, "walletName");
  const agentId = textField(body.value, "agentId");
  const requestId = textField(body.value, "requestId");
  if (!walletName || !agentId || !requestId) {
    return NextResponse.json({ error: "Wallet, agent, and execution request are required." }, { status: 400 });
  }
  if (!(await hasAgentServerWalletSignedOwnerApproval({
    walletName,
    agentId,
    action: "close_practice_trade",
    targetType: "execution",
    targetId: requestId,
  }))) {
    return NextResponse.json(
      { error: "Closing a connected practice trade needs wallet approval." },
      { status: 409 },
    );
  }

  const records = await listAgentServerExecutionRequests(walletName, agentId);
  const record = records.find((item) => item.id === requestId);
  if (!record || record.status !== "submitted" || !record.artifact) {
    return NextResponse.json({ error: "A submitted server-owned venue artifact was not found." }, { status: 404 });
  }
  if (!record.artifactHash || hashAgentServerExecutionArtifact(record.artifact) !== record.artifactHash) {
    return NextResponse.json({ error: "Stored opening artifact failed its integrity check." }, { status: 409 });
  }
  const configured = readHyperliquidTestnetExecutorConfig();
  if (!configured.config) {
    return NextResponse.json(
      { error: "Hyperliquid testnet executor configuration is invalid.", details: configured.errors },
      { status: 503 },
    );
  }
  if (record.settlementArtifact && record.settlementArtifactHash) {
    if (hashAgentServerExecutionArtifact(record.settlementArtifact) !== record.settlementArtifactHash) {
      return NextResponse.json({ error: "Stored settlement artifact failed its integrity check." }, { status: 409 });
    }
    try {
      const artifact = await verifyHyperliquidTestnetSettlementArtifact({
        claim: record.settlementArtifact,
        serverRequestId: record.id,
        request: record.request,
        openingArtifact: record.artifact,
        config: configured.config,
      });
      const saved = await recordAgentServerExecutionSettlement({
        walletName,
        agentId,
        requestId,
        artifact,
      });
      return NextResponse.json({
        ok: true,
        duplicate: true,
        serverRequest: saved.record,
        settlement: settlementInput(saved.record, saved.record.settlementArtifactHash!),
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Stored settlement lacks verified venue evidence." },
        { status: 409 },
      );
    }
  }

  const state = await getAgentServerWalletState(walletName);
  const proposal = state.proposals.find((item) => item.id === record.request.proposalId);
  const session = state.sessions.find((item) => item.id === proposal?.sessionId);
  if (
    !proposal?.sessionId ||
    !proposal.clearSignV2?.onchainProposal?.proposalAddress ||
    !session
  ) {
    return NextResponse.json(
      { error: "The opening trade and agent session records are incomplete." },
      { status: 409 },
    );
  }
  const openingProposalAddress = proposal.clearSignV2.onchainProposal.proposalAddress;
  try {
    if (!(await chainConfirmsProposalStatus(openingProposalAddress, "executed"))) {
      return NextResponse.json({ error: "Opening trade is not executed on chain." }, { status: 409 });
    }
    const connection = getConnection();
    const wallet = await fetchWalletByName(connection, walletName);
    const ledger = wallet
      ? await fetchAgentRiskLedger(connection, wallet.pda, proposal.sessionId)
      : null;
    const reserved = BigInt(decimalToAgentUsdRaw(record.request.notionalUsd));
    if (!ledger || reserved === 0n || reserved > ledger.openNotionalRaw) {
      return NextResponse.json(
        { error: "On-chain risk ledger does not contain this reserved exposure." },
        { status: 409 },
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Could not verify opening trade and risk ledger on chain." },
      { status: 503 },
    );
  }

  try {
    const artifact = await submitHyperliquidTestnetSettlement({
      serverRequestId: record.id,
      request: record.request,
      openingArtifact: record.artifact,
      config: configured.config,
    });
    const saved = await recordAgentServerExecutionSettlement({
      walletName,
      agentId,
      requestId,
      artifact,
    });
    return NextResponse.json({
      ok: true,
      duplicate: saved.duplicate,
      serverRequest: saved.record,
      settlement: settlementInput(saved.record, saved.record.settlementArtifactHash!),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Trusted venue settlement failed." },
      { status: 502 },
    );
  }
}

function settlementInput(
  record: Awaited<ReturnType<typeof listAgentServerExecutionRequests>>[number],
  artifactHash: string,
) {
  const artifact = record.settlementArtifact!;
  return {
    requestId: record.id,
    proposalId: record.request.proposalId,
    settlementArtifactHash: artifactHash,
    closedNotionalUsd: artifact.reservedNotionalUsd,
    realizedPnlUsd: artifact.realizedPnlUsd,
    artifact,
  };
}

async function readBody(request: NextRequest): Promise<
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; response: NextResponse }
> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    return { ok: false, response: NextResponse.json({ error: "Body is too large." }, { status: 413 }) };
  }
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return { ok: true, value: value as Record<string, unknown> };
  } catch {
    return { ok: false, response: NextResponse.json({ error: "Body must be JSON." }, { status: 400 }) };
  }
}

function textField(value: Record<string, unknown>, key: string): string {
  return typeof value[key] === "string" ? value[key].trim() : "";
}

function isProposalStatus(value: string): value is "created" | "approved" | "executed" {
  return value === "created" || value === "approved" || value === "executed";
}

async function chainConfirmsProposalStatus(
  address: string,
  claimed: "created" | "approved" | "executed",
): Promise<boolean> {
  const connection = getConnection();
  const publicKey = new PublicKey(address);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const info = await connection.getAccountInfo(publicKey, DEFAULT_COMMITMENT);
    if (info?.owner.equals(CLEAR_WALLET_PROGRAM_ID)) {
      const observed = parseAnyProposal(new Uint8Array(info.data)).status;
      if (claimed === "executed" && observed === ProposalStatus.Executed) return true;
      if (claimed === "approved" && (observed === ProposalStatus.Approved || observed === ProposalStatus.Executed)) return true;
      if (claimed === "created" && (observed === ProposalStatus.Active || observed === ProposalStatus.Approved || observed === ProposalStatus.Executed)) return true;
    }
    if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  return false;
}
