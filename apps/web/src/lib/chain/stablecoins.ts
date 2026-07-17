export interface StablecoinDeployment {
  symbol: "USDC" | "USDT";
  network: "ethereum-sepolia" | "hyperevm-testnet" | "solana-devnet";
  address: string;
  decimals: number;
  issuer: "Circle" | "Tether";
  typedSendAvailable: boolean;
}

/** Issuer-published deployments for networks ClearSig currently exposes. */
export const STABLECOIN_DEPLOYMENTS: readonly StablecoinDeployment[] = [
  {
    symbol: "USDC",
    network: "ethereum-sepolia",
    address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    decimals: 6,
    issuer: "Circle",
    typedSendAvailable: true,
  },
  {
    symbol: "USDC",
    network: "hyperevm-testnet",
    address: "0x2B3370eE501B4a559b57D449569354196457D8Ab",
    decimals: 6,
    issuer: "Circle",
    typedSendAvailable: false,
  },
  {
    symbol: "USDC",
    network: "solana-devnet",
    address: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    decimals: 6,
    issuer: "Circle",
    typedSendAvailable: false,
  },
] as const;

export const ETHEREUM_SEPOLIA_USDC = STABLECOIN_DEPLOYMENTS[0];

export function stablecoinsForNetwork(
  network: StablecoinDeployment["network"],
): readonly StablecoinDeployment[] {
  return STABLECOIN_DEPLOYMENTS.filter((entry) => entry.network === network);
}
