import { Connection, PublicKey } from "@solana/web3.js";

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);

export interface SolanaTokenHolding {
  mint: string;
  tokenAccount: string;
  rawBalance: bigint;
  decimals: number;
  symbol: string;
  name: string;
}

const KNOWN_TOKEN_METADATA: Record<string, { symbol: string; name: string }> = {
  // Circle devnet USDC.
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU": {
    symbol: "USDC",
    name: "USD Coin",
  },
  // Mainnet assets remain useful for local/mainnet-compatible reads.
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: {
    symbol: "USDC",
    name: "USD Coin",
  },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: {
    symbol: "USDT",
    name: "Tether USD",
  },
};

export function solanaTokenMetadata(mint: string): {
  symbol: string;
  name: string;
} {
  return (
    KNOWN_TOKEN_METADATA[mint] ?? {
      symbol: `${mint.slice(0, 4)}...${mint.slice(-4)}`,
      name: "Solana token",
    }
  );
}

export async function fetchSolanaTokenHoldings(
  connection: Connection,
  ownerAddress: string,
): Promise<SolanaTokenHolding[]> {
  const owner = new PublicKey(ownerAddress);
  const results = await Promise.all(
    [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((programId) =>
      connection.getParsedTokenAccountsByOwner(
        owner,
        { programId },
        "confirmed",
      ),
    ),
  );

  const holdings: SolanaTokenHolding[] = [];
  for (const result of results) {
    for (const { account, pubkey } of result.value) {
      const parsed = account.data as {
        parsed?: {
          info?: {
            mint?: string;
            tokenAmount?: { amount?: string; decimals?: number };
          };
        };
      };
      const mint = parsed.parsed?.info?.mint;
      const amount = parsed.parsed?.info?.tokenAmount?.amount;
      const decimals = parsed.parsed?.info?.tokenAmount?.decimals;
      if (!mint || !amount || decimals === undefined) continue;
      const rawBalance = BigInt(amount);
      if (rawBalance <= 0n) continue;
      const metadata = solanaTokenMetadata(mint);
      holdings.push({
        mint,
        tokenAccount: pubkey.toBase58(),
        rawBalance,
        decimals,
        ...metadata,
      });
    }
  }
  return holdings.sort((a, b) => a.symbol.localeCompare(b.symbol));
}
