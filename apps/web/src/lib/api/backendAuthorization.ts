import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { authenticateNotificationRequest } from "@/lib/notifications/dynamicAuth";
import { authenticateWalletMember, walletAuthorizationFailure } from "@/lib/auth/walletAuthorization";
import { checkRateLimit } from "@/lib/api/rateLimit";

export async function authorizeBackendProxy(request: NextRequest, path: string[], body?: string): Promise<
  | { ok: true; headers: Record<string, string> }
  | { ok: false; response: NextResponse }
> {
  if (path.some((part) => part === "." || part === ".." || /[\/\\\u0000-\u001f]/.test(part))) {
    return { ok: false, response: NextResponse.json({ error: "Invalid backend path." }, { status: 400 }) };
  }
  const isCreate = request.method === "POST" && path.length === 1 && path[0] === "wallets";
  const isPro = path[0] === "v1" && path[1] === "pro";
  if (request.method === "POST" && path.length === 4 && path[0] === "wallets" && path[2] === "chains" && path[3] === "add") {
    return { ok: false, response: NextResponse.json({ error: "Chain binding requires the wallet creator's operator bootstrap. Member access alone does not authorize a chain binding." }, { status: 403 }) };
  }
  if (!isCreate && !isPro) return { ok: true, headers: {} };
  const token = process.env.CLEAR_MSIG_BACKEND_GATEWAY_TOKEN;
  if (!token || token.length < 32 || token.length > 512 || !/^[\x21-\x7e]+$/.test(token)) {
    return { ok: false, response: NextResponse.json({ error: "Private backend access is not configured." }, { status: 503 }) };
  }
  let payload: Record<string, unknown> = {};
  if (body !== undefined) {
    try {
      const parsed: unknown = JSON.parse(body);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      payload = parsed as Record<string, unknown>;
    } catch { return { ok: false, response: NextResponse.json({ error: "Body must be a JSON object." }, { status: 400 }) }; }
  }
  try {
    if (isCreate) {
      const identity = await authenticateNotificationRequest(request);
      const proposers = Array.isArray(payload.proposers) ? payload.proposers : [];
      const approvers = Array.isArray(payload.approvers) ? payload.approvers : [];
      if (!identity.verifiedSolanaWallets.some((actor) => proposers.includes(actor) || approvers.includes(actor))) {
        return { ok: false, response: NextResponse.json({ error: "The new wallet must include a Solana identity verified by your signed-in session." }, { status: 403 }) };
      }
      const limited = await checkRateLimit("sponsored-wallet-create", identity.userId, { capacity: 3, refillPerSec: 1 / 3600 });
      if (limited) return { ok: false, response: limited };
    } else {
      const walletName = path[2] === "wallets" ? path[3] : payload.walletName;
      if (typeof walletName !== "string" || !walletName) {
        return { ok: false, response: NextResponse.json({ error: "A canonical wallet must be selected." }, { status: 400 }) };
      }
      await authenticateWalletMember(request, walletName);
    }
    return { ok: true, headers: { "x-clearsig-backend-token": token } };
  } catch (error) { return { ok: false, response: walletAuthorizationFailure(error) }; }
}
