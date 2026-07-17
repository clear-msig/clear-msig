import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, clientIp } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import {
  authenticateNotificationRequest,
  NotificationAuthError,
} from "@/lib/notifications/dynamicAuth";
import {
  ingestServerNotifications,
  listServerNotifications,
  markAllServerNotificationsSeen,
  markServerNotificationSeen,
  notificationStorageMode,
  NotificationPersistenceError,
} from "@/lib/notifications/server";
import type { NotificationEventInput, NotificationKind } from "@/lib/notifications/types";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 30_000;
const notificationKinds = new Set<NotificationKind>([
  "pending_approval",
  "wallet_request",
  "membership_change",
  "money_movement",
]);

export async function GET(request: NextRequest) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;
  try {
    const { userId } = await authenticateNotificationRequest(request);
    return NextResponse.json({
      ok: true,
      storage: notificationStorageMode(),
      entries: await listServerNotifications(userId),
    });
  } catch (error) {
    return notificationError(error);
  }
}

export async function POST(request: NextRequest) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;
  const limited = await checkRateLimit("notifications", clientIp(request), {
    capacity: 60,
    refillPerSec: 1,
  });
  if (limited) return limited;

  try {
    const { userId } = await authenticateNotificationRequest(request);
    const body = await readBody(request);
    const action = readString(body, "action");
    if (action === "ingest") {
      const rawEntries = Array.isArray(body.entries) ? body.entries.slice(0, 50) : [];
      const entries = rawEntries.map(parseEvent).filter((entry): entry is NotificationEventInput => !!entry);
      if (entries.length !== rawEntries.length || entries.length === 0) {
        return NextResponse.json({ error: "Valid notification entries are required." }, { status: 400 });
      }
      return NextResponse.json({
        ok: true,
        storage: notificationStorageMode(),
        results: await ingestServerNotifications(userId, entries),
      });
    }
    if (action === "mark_seen") {
      const id = readString(body, "id");
      if (!id || !/^[a-f0-9]{32}$/.test(id)) {
        return NextResponse.json({ error: "A valid notification id is required." }, { status: 400 });
      }
      return NextResponse.json({
        ok: true,
        entry: await markServerNotificationSeen(userId, id),
      });
    }
    if (action === "mark_all_seen") {
      await markAllServerNotificationsSeen(userId);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown notification action." }, { status: 400 });
  } catch (error) {
    return notificationError(error);
  }
}

async function readBody(request: NextRequest): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) throw new RequestError("Request is too large.", 413);
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    throw new RequestError("Request is too large.", 413);
  }
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RequestError("Body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function parseEvent(value: unknown): NotificationEventInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const sourceId = clean(row.sourceId, 240);
  const kind = clean(row.kind, 40) as NotificationKind;
  const walletName = clean(row.walletName, 120);
  const title = clean(row.title, 180);
  const body = clean(row.body, 500);
  const href = clean(row.href, 500, true);
  if (!sourceId || !notificationKinds.has(kind) || !walletName || !title || !body) return null;
  if (href && (!href.startsWith("/") || href.startsWith("//"))) return null;
  return {
    sourceId,
    kind,
    walletName,
    title,
    body,
    href: href || undefined,
    createdAt: typeof row.createdAt === "number" ? row.createdAt : undefined,
  };
}

function readString(body: Record<string, unknown>, key: string): string {
  return typeof body[key] === "string" ? body[key].trim() : "";
}

function clean(value: unknown, max: number, optional = false): string {
  if (typeof value !== "string") return optional ? "" : "";
  return value.trim().slice(0, max);
}

function notificationError(error: unknown): NextResponse {
  if (error instanceof NotificationAuthError || error instanceof RequestError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof NotificationPersistenceError) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: "Body must be valid JSON." }, { status: 400 });
  }
  console.error("[notifications]", error);
  return NextResponse.json({ error: "Notification sync failed." }, { status: 500 });
}

class RequestError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
