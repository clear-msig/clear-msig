import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, clientIp } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { normalizeAgentSignalPayload } from "@/lib/agents/intake";
import { verifyAgentSignalSignature } from "@/lib/agents/signalSignature";
import {
  enqueueAgentSignal,
  agentAutomaticTradingEnabled,
  agentInboxStorageMode,
  listAgentInboxSignals,
  registerAgentSignalKey,
  removeAgentInboxSignals,
  verifyAgentManagementKey,
  verifyAgentSignalKey,
} from "@/lib/agents/serverInbox";
import { importAgentInboxSignals } from "@/lib/agents/serverInboxImport";
import { executeAllowedAgentProposal } from "@/lib/agents/serverAutomaticExecution";

const MAX_BODY_BYTES = 8_000;
const MAX_SIGNAL_KEY_BYTES = 160;
const MAX_MANAGEMENT_KEY_BYTES = 200;
const MAX_SIGNAL_AGE_MS = 10 * 60 * 1000;
const MAX_SIGNAL_FUTURE_SKEW_MS = 2 * 60 * 1000;

interface RouteContext {
  params: Promise<{
    name: string;
    agent: string;
  }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const { name, agent } = await context.params;
  const walletName = decodeRouteParam(name);
  const agentId = decodeRouteParam(agent);
  const managementError = await requireManagementKey(request, walletName, agentId);
  if (managementError) return managementError;

  return NextResponse.json({
    ok: true,
    storage: agentInboxStorageMode(),
    signals: await listAgentInboxSignals(walletName, agentId),
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { name, agent } = await context.params;
  const walletName = decodeRouteParam(name);
  const agentId = decodeRouteParam(agent);

  const raw = await readBoundedBody(request);
  if (!raw.ok) return raw.response;

  let body: unknown;
  try {
    body = JSON.parse(raw.text);
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const action = readStringField(body, "action");
  if (action === "register") {
    const blocked = assertSameOrigin(request);
    if (blocked) return blocked;
    const signalKey = readStringField(body, "signalKey");
    const managementKey = readStringField(body, "managementKey");
    if (!validSignalKey(signalKey)) {
      return NextResponse.json(
        { error: "Signal key is missing or invalid." },
        { status: 400 },
      );
    }
    if (!validManagementKey(managementKey)) {
      return NextResponse.json(
        { error: "Management key is missing or invalid." },
        { status: 401 },
      );
    }
    try {
      await registerAgentSignalKey({
        walletName,
        agentId,
        signalKey,
        managementKey,
        autoImportSessionSignals: readBooleanField(body, "autoImportSessionSignals"),
      });
    } catch (error) {
      console.error("[agent-signals] register failed", error);
      return NextResponse.json(
        { error: "Could not register signal key." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: true, storage: agentInboxStorageMode() });
  }
  if (action === "import") {
    const blocked = assertSameOrigin(request);
    if (blocked) return blocked;
    const managementError = await requireManagementKey(request, walletName, agentId);
    if (managementError) return managementError;
    const ids = readStringArrayField(body, "ids");
    if (ids.length === 0) {
      return NextResponse.json(
        { error: "No signal ids supplied." },
        { status: 400 },
      );
    }
    try {
      const result = await importAgentInboxSignals({
        walletName,
        agentId,
        ids,
        allowedOnly: readBooleanField(body, "allowedOnly"),
      });
      return NextResponse.json({
        ok: true,
        storage: agentInboxStorageMode(),
        ...result,
      });
    } catch (error) {
      console.error("[agent-signals] import failed", error);
      return NextResponse.json(
        { error: "Could not import inbox signals." },
        { status: 503 },
      );
    }
  }

  const limited = await checkRateLimit(
    "agent-signals",
    `${clientIp(request)}:${walletName}:${agentId}`,
    {
      capacity: 20,
      refillPerSec: 1 / 5,
    },
  );
  if (limited) return limited;

  const signalKey =
    request.headers.get("x-clearsig-signal-key")?.trim() ??
    readStringField(body, "signalKey");
  if (!validSignalKey(signalKey)) {
    return NextResponse.json({ error: "Missing signal key." }, { status: 401 });
  }
  let verified: boolean;
  try {
    verified = await verifyAgentSignalKey({ walletName, agentId, signalKey });
  } catch (error) {
    console.error("[agent-signals] key verification failed", error);
    return NextResponse.json(
      { error: "Signal inbox is unavailable." },
      { status: 503 },
    );
  }
  if (!verified) {
    return NextResponse.json({ error: "Invalid signal key." }, { status: 401 });
  }

  const signalInput = readObjectField(body, "signal") ?? body;
  const parsed = normalizeAgentSignalPayload(signalInput, {
    requireClientMetadata: true,
  });
  if (!parsed.payload) {
    return NextResponse.json(
      { error: "Signal failed validation.", details: parsed.errors },
      { status: 400 },
    );
  }
  const freshnessError = signalFreshnessError(parsed.payload.submittedAt);
  if (freshnessError) {
    return NextResponse.json(
      { error: freshnessError },
      { status: 400 },
    );
  }
  const submittedSignature =
    request.headers.get("x-clearsig-signal-signature")?.trim() ??
    readStringField(body, "signature");
  const verification = submittedSignature
    ? verifyAgentSignalSignature({
        signal: parsed.payload,
        signalKey,
        signature: submittedSignature,
      })
    : null;
  if (verification && !verification.ok) {
    return NextResponse.json(
      {
        error: "Signal signature failed verification.",
        details: [verification.message],
        verification: {
          scheme: verification.scheme,
          status: "failed",
        },
      },
      { status: 401 },
    );
  }

  let result;
  try {
    result = await enqueueAgentSignal({
      walletName,
      agentId,
      payload: parsed.payload,
    });
  } catch (error) {
    console.error("[agent-signals] enqueue failed", error);
    return NextResponse.json(
      { error: "Could not queue signal." },
      { status: 503 },
    );
  }
  let automatic:
    | {
        accepted: boolean;
        placed: boolean;
        message: string;
      }
    | undefined;
  if (
    !result.duplicate &&
    (await agentAutomaticTradingEnabled(walletName, agentId))
  ) {
    try {
      const imported = await importAgentInboxSignals({
        walletName,
        agentId,
        ids: [result.item.id],
        allowedOnly: true,
      });
      const accepted = imported.imported[0]?.proposal;
      if (accepted) {
        const placed = await executeAllowedAgentProposal(accepted);
        automatic = {
          accepted: true,
          placed: placed.placed,
          message: placed.message,
        };
      }
    } catch (error) {
      console.error("[agent-signals] automatic trading failed", error);
    }
  }
  return NextResponse.json({
    ok: true,
    id: result.item.id,
    duplicate: result.duplicate,
    receivedAt: result.item.receivedAt,
    status: result.duplicate
      ? "duplicate_ignored"
      : automatic?.placed
        ? "accepted_and_placed"
        : automatic?.accepted
          ? "accepted_but_not_placed"
          : "queued_for_clearsig_risk_check",
    automatic,
    verification: verification
      ? {
          scheme: verification.scheme,
          status: "signed_decision",
          message: verification.message,
        }
      : {
          scheme: "signal_key_only",
          status: "accepted_without_signature",
          message: "Signal key verified. Signed decision envelope was not supplied.",
        },
  });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const { name, agent } = await context.params;
  const walletName = decodeRouteParam(name);
  const agentId = decodeRouteParam(agent);
  const managementError = await requireManagementKey(request, walletName, agentId);
  if (managementError) return managementError;
  const raw = await readBoundedBody(request);
  if (!raw.ok) return raw.response;

  let body: { ids?: unknown };
  try {
    body = JSON.parse(raw.text);
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "No signal ids supplied." }, { status: 400 });
  }
  const removed = await removeAgentInboxSignals(walletName, agentId, ids);
  return NextResponse.json({ ok: true, removed });
}

async function readBoundedBody(
  request: NextRequest,
): Promise<{ ok: true; text: string } | { ok: false; response: NextResponse }> {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Signal body is too large." },
        { status: 413 },
      ),
    };
  }
  return { ok: true, text };
}

function decodeRouteParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function readStringField(input: unknown, field: string): string {
  if (!input || typeof input !== "object") return "";
  const value = (input as Record<string, unknown>)[field];
  return typeof value === "string" ? value.trim() : "";
}

function readObjectField(input: unknown, field: string): Record<string, unknown> | null {
  if (!input || typeof input !== "object") return null;
  const value = (input as Record<string, unknown>)[field];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readStringArrayField(input: unknown, field: string): string[] {
  if (!input || typeof input !== "object") return [];
  const value = (input as Record<string, unknown>)[field];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function readBooleanField(input: unknown, field: string): boolean {
  if (!input || typeof input !== "object") return false;
  return (input as Record<string, unknown>)[field] === true;
}

function validSignalKey(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_SIGNAL_KEY_BYTES &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

function validManagementKey(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_MANAGEMENT_KEY_BYTES &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

async function requireManagementKey(
  request: NextRequest,
  walletName: string,
  agentId: string,
): Promise<NextResponse | null> {
  const managementKey =
    request.headers.get("x-clearsig-management-key")?.trim() ?? "";
  if (!validManagementKey(managementKey)) {
    return NextResponse.json({ error: "Missing management key." }, { status: 401 });
  }
  let verified = false;
  try {
    verified = await verifyAgentManagementKey({
      walletName,
      agentId,
      managementKey,
    });
  } catch (error) {
    console.error("[agent-signals] management verification failed", error);
    return NextResponse.json(
      { error: "Signal inbox is unavailable." },
      { status: 503 },
    );
  }
  if (!verified) {
    return NextResponse.json({ error: "Invalid management key." }, { status: 401 });
  }
  return null;
}

function signalFreshnessError(submittedAt: number | undefined): string | null {
  if (submittedAt == null) return null;
  const now = Date.now();
  if (submittedAt < now - MAX_SIGNAL_AGE_MS) {
    return "Signal is stale. Submit a fresh signal.";
  }
  if (submittedAt > now + MAX_SIGNAL_FUTURE_SKEW_MS) {
    return "Signal timestamp is too far in the future.";
  }
  return null;
}
