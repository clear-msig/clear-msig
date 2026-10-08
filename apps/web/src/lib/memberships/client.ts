// Memberships client . browser-direct by default, graceful backend
// fallback on RPC failure (e.g. restricted networks that block the
// public Solana RPC).
//
// Returned shape matches what the backend's `/memberships` route
// produced, so existing consumers (MyOrganizationsCard) don't need
// changes. The heavy lifting lives in `lib/chain/memberships.ts`; this
// file is the stable import-path façade.

import { Connection, PublicKey } from "@solana/web3.js";
import { backendApi } from "@/lib/api/endpoints";
import { getConnection } from "@/lib/chain/client";
import { listMemberships, type OnchainMembership } from "@/lib/chain/memberships";

export type { OnchainMembership };

interface FetchOptions {
  /// Skip the direct-RPC path and hit the backend instead. Useful for
  /// environments that block `getProgramAccounts` on public RPCs.
  preferBackend?: boolean;
  /// Override the Connection. Defaults to the chain/client singleton.
  connection?: Connection;
  signal?: AbortSignal;
}

export async function fetchOnchainMemberships(
  address: string,
  opts: FetchOptions = {}
): Promise<OnchainMembership[]> {
  opts.signal?.throwIfAborted();
  if (!opts.preferBackend) {
    try {
      return await boundedRead(
        listMemberships(opts.connection ?? getConnection(), address),
        opts.signal,
      );
    } catch {
      // An account/network switch cancels this discovery, including fallback.
      opts.signal?.throwIfAborted();
    }
  }

  const payload: unknown = await backendApi.memberships(address, {
    signal: opts.signal,
    timeoutMs: 12_000,
  });
  opts.signal?.throwIfAborted();
  return parseMembershipResponse(payload);
}

/** Reject the whole response: dropping malformed rows would misreport access. */
export function parseMembershipResponse(payload: unknown): OnchainMembership[] {
  const invalid = () =>
    new Error("Wallet discovery returned an invalid response. Please try again.");
  if (
    !payload || typeof payload !== "object" ||
    !("organizations" in payload) || !Array.isArray(payload.organizations)
  ) throw invalid();
  return payload.organizations.map((row: unknown) => {
    if (!row || typeof row !== "object") throw invalid();
    const value = row as Record<string, unknown>;
    if (
      !isPublicKey(value.wallet) ||
      (value.wallet_name != null &&
        (typeof value.wallet_name !== "string" || !value.wallet_name.trim())) ||
      (value.wallet_creator != null && !isPublicKey(value.wallet_creator)) ||
      !Array.isArray(value.roles) || !value.roles.length ||
      !value.roles.every((role) => role === "proposer" || role === "approver") ||
      !Array.isArray(value.intent_indexes) ||
      !value.intent_indexes.every((index) =>
        Number.isInteger(index) && index >= 0 && index <= 255)
    ) throw invalid();
    return {
      wallet: value.wallet,
      wallet_name: typeof value.wallet_name === "string" ? value.wallet_name : undefined,
      wallet_creator: typeof value.wallet_creator === "string" ? value.wallet_creator : undefined,
      roles: value.roles,
      intent_indexes: value.intent_indexes,
    };
  });
}

function isPublicKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}

// web3's account scan has no per-call AbortSignal. Bound the wait and discard
// late results; the underlying read may finish, but cannot route the new user.
async function boundedRead<T>(read: Promise<T>, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      read,
      new Promise<never>((_, reject) => {
        onAbort = () => reject(signal?.reason ?? new Error("Discovery cancelled"));
        timer = setTimeout(() => reject(new Error("Wallet discovery timed out")), 12_000);
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) onAbort();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}
