import type { ClearSignSurfaceStatus } from "@/lib/clearsign-v2/surfaceCoverage";

export type ClearSignedChainKey = "eth" | "btc" | "zec" | "hyperliquid";

export interface ClearSignedChainAssurance {
  key: ClearSignedChainKey;
  surfaceId: "eth-send" | "btc-send" | "zec-send" | "hyperliquid-send";
  label: string;
  status: ClearSignSurfaceStatus;
  chainKind: 1 | 2 | 3 | 5;
  ticker: "ETH" | "BTC" | "ZEC" | "HYPE";
  intentFile: string;
  setupRoute: string;
  sendRoute: string;
  signPreview: true;
  approvalGate: "wallet_proposal";
  executeMode: "execute_then_broadcast";
  broadcastNetwork: string;
  primarySafetyCheck: string;
}

export const CLEAR_SIGNED_CHAIN_ASSURANCES: readonly ClearSignedChainAssurance[] = [
  {
    key: "eth",
    surfaceId: "eth-send",
    label: "Ethereum",
    status: "legacy_custom_pending_typed_executor",
    chainKind: 1,
    ticker: "ETH",
    intentFile: "examples/intents/evm_transfer_sepolia.json",
    setupRoute: "/setup/eth",
    sendRoute: "/send/eth",
    signPreview: true,
    approvalGate: "wallet_proposal",
    executeMode: "execute_then_broadcast",
    broadcastNetwork: "Ethereum Sepolia",
    primarySafetyCheck: "recipient, nonce, amount, balance, and gas reserve",
  },
  {
    key: "btc",
    surfaceId: "btc-send",
    label: "Bitcoin",
    status: "legacy_custom_pending_typed_executor",
    chainKind: 2,
    ticker: "BTC",
    intentFile: "examples/intents/btc_transfer.json",
    setupRoute: "/send/btc?autostart=1",
    sendRoute: "/send/btc",
    signPreview: true,
    approvalGate: "wallet_proposal",
    executeMode: "execute_then_broadcast",
    broadcastNetwork: "Bitcoin testnet/signet Esplora",
    primarySafetyCheck: "P2WPKH recipient, UTXO, fee reserve, and change output",
  },
  {
    key: "zec",
    surfaceId: "zec-send",
    label: "Zcash transparent",
    status: "legacy_custom_pending_typed_executor",
    chainKind: 3,
    ticker: "ZEC",
    intentFile: "examples/intents/zcash_transfer.json",
    setupRoute: "/send/zec?autostart=1",
    sendRoute: "/send/zec",
    signPreview: true,
    approvalGate: "wallet_proposal",
    executeMode: "execute_then_broadcast",
    broadcastNetwork: "Zcash transparent RPC",
    primarySafetyCheck: "transparent address, UTXO, amount, and fee reserve",
  },
  {
    key: "hyperliquid",
    surfaceId: "hyperliquid-send",
    label: "Hyperliquid HyperEVM",
    status: "legacy_custom_pending_typed_executor",
    chainKind: 5,
    ticker: "HYPE",
    intentFile: "examples/intents/hyperliquid_transfer.json",
    setupRoute: "/setup/eth?network=hyperliquid",
    sendRoute: "/send/eth?network=hyperliquid",
    signPreview: true,
    approvalGate: "wallet_proposal",
    executeMode: "execute_then_broadcast",
    broadcastNetwork: "Hyperliquid HyperEVM",
    primarySafetyCheck: "recipient, nonce, amount, balance, and gas reserve",
  },
] as const;

export function clearSignedChainAssurance(
  key: ClearSignedChainKey,
): ClearSignedChainAssurance {
  const found = CLEAR_SIGNED_CHAIN_ASSURANCES.find((item) => item.key === key);
  if (!found) {
    throw new Error(`Unsupported ClearSigned chain: ${key}`);
  }
  return found;
}

export function clearSignedChainAssuranceByKind(
  chainKind: number,
): ClearSignedChainAssurance | null {
  return (
    CLEAR_SIGNED_CHAIN_ASSURANCES.find((item) => item.chainKind === chainKind) ??
    null
  );
}
