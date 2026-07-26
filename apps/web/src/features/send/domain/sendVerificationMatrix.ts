import type {
  ClearSignIntentInput,
  ClearSignNetwork,
  SendPayload,
} from "@/lib/clearsign/intentInput";

export type SendSignerRuntime =
  | "google-waas"
  | "phantom"
  | "solflare"
  | "turnkey-legacy";

export interface SendAssetVerification {
  id: "sol" | "btc" | "zec" | "eth" | "hype" | "sepolia-usdc";
  routeSource: string;
  contractSources?: readonly string[];
  executionMarker: string;
  payload: SendPayload;
}

export const SEND_SIGNER_RUNTIMES: readonly SendSignerRuntime[] = [
  "google-waas",
  "phantom",
  "solflare",
  "turnkey-legacy",
];

export const SEND_ASSET_VERIFICATIONS: readonly SendAssetVerification[] = [
  {
    id: "sol",
    routeSource: "src/features/send/routes/SolanaSendPage.tsx",
    contractSources: [
      "src/features/send/infrastructure/prepareSolanaSendProposal.ts",
      "src/features/send/infrastructure/finalizeSolanaSend.ts",
    ],
    executionMarker: "executeTypedSolSend",
    payload: {
      recipient: "11111111111111111111111111111111",
      recipientEncoding: "solana_pubkey",
      amount: "0.01",
      asset: "SOL",
      note: "Signing matrix verification",
    },
  },
  {
    id: "btc",
    routeSource: "src/features/send/routes/BtcSendPage.tsx",
    executionMarker: "executeTypedChainSend",
    payload: {
      recipient:
        "tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7",
      recipientEncoding: "sha256_text",
      amount: "0.0001",
      asset: "BTC",
      note: "Signing matrix verification",
    },
  },
  {
    id: "zec",
    routeSource: "src/features/send/routes/ZecSendPage.tsx",
    executionMarker: "executeTypedChainSend",
    payload: {
      recipient: "tm9iMLAuYMzJ4PiuGGtYwXKz9LqWYBS65vK",
      recipientEncoding: "sha256_text",
      amount: "0.001",
      asset: "ZEC",
      note: "Signing matrix verification",
    },
  },
  {
    id: "eth",
    routeSource: "src/features/send/routes/EthSendPage.tsx",
    executionMarker: "executeTypedChainSend",
    payload: {
      recipient: "0x1111111111111111111111111111111111111111",
      recipientEncoding: "sha256_text",
      amount: "0.01",
      asset: "ETH",
      note: "Signing matrix verification",
    },
  },
  {
    id: "hype",
    routeSource: "src/features/send/routes/EthSendPage.tsx",
    executionMarker: "executeTypedChainSend",
    payload: {
      recipient: "0x3333333333333333333333333333333333333333",
      recipientEncoding: "sha256_text",
      amount: "1",
      asset: "HYPE",
      note: "Signing matrix verification",
    },
  },
  {
    id: "sepolia-usdc",
    routeSource: "src/features/send/routes/Erc20SendPage.tsx",
    executionMarker: "executeTypedChainSend",
    payload: {
      recipient: "0x2222222222222222222222222222222222222222",
      recipientEncoding: "sha256_text",
      amount: "1",
      asset: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      assetEncoding: "sha256_text",
      decimals: 6,
      displayAsset: "USDC",
      note: "Signing matrix verification",
    },
  },
];

export function sendVerificationEnvelope(
  asset: SendAssetVerification,
): ClearSignIntentInput<SendPayload> {
  return {
    kind: "send",
    network: sendVerificationNetwork(asset.id),
    walletName: "Signing matrix",
    actionId: `send-matrix:${asset.id}`,
    nonce: `send-matrix:${asset.id}:nonce`,
    expiresAt: 2_000_000_000,
    policyCommitment: "00".repeat(32),
    payload: asset.payload,
  };
}

function sendVerificationNetwork(
  id: SendAssetVerification["id"],
): ClearSignNetwork {
  switch (id) {
    case "sol":
      return "Solana devnet";
    case "btc":
      return "Bitcoin testnet";
    case "zec":
      return "Zcash testnet";
    case "eth":
    case "sepolia-usdc":
      return "Ethereum Sepolia";
    case "hype":
      return "Hyperliquid testnet";
  }
}
