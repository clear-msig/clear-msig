// Memberships client . browser-direct by default, graceful backend
// fallback on RPC failure (e.g. restricted networks that block the
// public Solana RPC).
//
// Returned shape matches what the backend's `/memberships` route
// produced, so existing consumers (MyOrganizationsCard) don't need
// changes. The heavy lifting lives in `lib/chain/memberships.ts`; this
// file is the stable import-path façade.

import { Connection } from "@solana/web3.js";
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
}

export async function fetchOnchainMemberships(
  address: string,
  opts: FetchOptions = {}
): Promise<OnchainMembership[]> {
  if (!opts.preferBackend) {
    try {
      return await listMemberships(opts.connection ?? getConnection(), address);
    } catch (err) {
      if (typeof console !== "undefined") {
        console.warn(
          "fetchOnchainMemberships: direct RPC failed, falling back to backend:",
          err
        );
      }
    }
  }

  const payload = (await backendApi.memberships(address)) as {
    organizations?: OnchainMembership[];
  };
  return Array.isArray(payload.organizations) ? payload.organizations : [];
}
