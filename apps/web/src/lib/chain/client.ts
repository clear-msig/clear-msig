// Direct-from-chain reads. Browser uses @solana/web3.js to read wallets,
// intents, proposals, and IKA configs without any backend dependency.
//
// Two consumption patterns:
//   - React components / hooks: `const { connection } = useConnection()`
//     from @/lib/wallet, then pass into the chain/* helpers. The shim
//     hands back the same shared Connection the rest of the app uses.
//   - Non-React contexts (init scripts, tests): `getConnection()`
//     returns a lazy-initialised singleton.
//
// `CLEAR_WALLET_PROGRAM_ID` is the deployed program ID. It defaults to the
// current fresh devnet migration target, but can be overridden per-env with
// `NEXT_PUBLIC_CLEAR_WALLET_PROGRAM_ID` when needed.

import { Commitment, Connection, PublicKey } from "@solana/web3.js";
import { createSolanaConnection } from "@/lib/solana/cluster";

/// The clear-wallet on-chain program ID. Matches `crate::ID` in
/// programs/clear-wallet/src/lib.rs.
export const CLEAR_WALLET_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_CLEAR_WALLET_PROGRAM_ID ??
    "53aZBmukjX5sYxbrYVRDd2DWzsRWVmvVFPY6PcyomR5v"
);

/// Default commitment for all read paths. `confirmed` is the sweet spot
/// for hackathon UX: roughly-finalised state, but one slot faster than
/// `finalized`.
export const DEFAULT_COMMITMENT: Commitment = "confirmed";

// Lazy singleton . we only build it when the first non-React caller
// asks, so tests can call `setConnection` before anything reaches out.
let singleton: Connection | null = null;

/// Replace the connection (tests / SSR bootstrap).
export function setConnection(conn: Connection): void {
  singleton = conn;
}

/// Get a shared Connection for non-React contexts. React components
/// should use `useConnection()` from @/lib/wallet.
export function getConnection(): Connection {
  if (!singleton) {
    singleton = createSolanaConnection(DEFAULT_COMMITMENT);
  }
  return singleton;
}
