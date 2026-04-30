// Retail-facing formatters. Currency framing is identical across the
// dashboard cards, the wallet detail hero, and any other surface that
// shows a balance — so the conversion lives in one place.

const LAMPORTS_PER_SOL = 1_000_000_000;

/// Treat $1 ≈ 1 SOL until a price oracle lands. Same convention as
/// `/send`'s lamports conversion — keep them in sync.
export function formatBalance(lamports: number): {
  dollars: string;
  sol: string;
} {
  const sol = lamports / LAMPORTS_PER_SOL;
  return {
    dollars: sol.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
    }),
    sol: `${sol.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 6,
    })} SOL`,
  };
}
