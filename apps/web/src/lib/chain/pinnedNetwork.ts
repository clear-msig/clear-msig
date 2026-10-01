import type { Connection } from "@solana/web3.js";

/** A network identity failure must never be treated as ordinary RPC finality lag. */
export class PinnedNetworkError extends Error {}

export async function assertPinnedSolanaNetwork(
  connection: Connection,
): Promise<void> {
  const expected = process.env.NEXT_PUBLIC_SOLANA_EXPECTED_GENESIS_HASH?.trim();
  if (!expected)
    throw new PinnedNetworkError(
      "The configured Solana genesis identity is required before verification or execution.",
    );
  let actual: string;
  try {
    actual = await connection.getGenesisHash();
  } catch {
    throw new PinnedNetworkError(
      "Solana network identity could not be verified. No new execution is authorized.",
    );
  }
  if (actual !== expected)
    throw new PinnedNetworkError(
      "RPC network differs from the configured Solana genesis identity. No new execution is authorized.",
    );
}
