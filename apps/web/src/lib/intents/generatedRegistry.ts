// Generated from examples/intents/registry-v1.json. Do not edit manually.

export const INTENT_SCHEMA_VERSION = 1 as const;

export const INTENT_TEMPLATES = [
  {
    id: "cb_initialize_account_breaker_v1",
    file: "examples/intents/cb_initialize_account_breaker.json",
    chainKind: 0,
    chain: "solana",
    template: "initialize circuit breaker for token account {0} with authority {1}: window_size_seconds={2} threshold_type={3} threshold={4}",
    defaultForChain: false,
  },
  {
    id: "cb_update_account_config_v1",
    file: "examples/intents/cb_update_account_config.json",
    chainKind: 0,
    chain: "solana",
    template: "update circuit breaker {0} config: window_size_seconds={1} threshold_type={2} threshold={3}",
    defaultForChain: false,
  },
  {
    id: "solana_transfer_v1",
    file: "examples/intents/solana_transfer.json",
    chainKind: 0,
    chain: "solana",
    template: "transfer {1:10^9} SOL to {0}",
    defaultForChain: true,
  },
  {
    id: "solana_transfer_legacy_v1",
    file: "examples/intents/transfer_sol.json",
    chainKind: 0,
    chain: "solana",
    template: "transfer {1:10^9} SOL to {0}",
    defaultForChain: false,
  },
  {
    id: "spl_token_transfer_v1",
    file: "examples/intents/transfer_tokens.json",
    chainKind: 0,
    chain: "solana",
    template: "transfer {2} of mint {1} to {0}",
    defaultForChain: false,
  },
  {
    id: "evm_transfer_mainnet_v1",
    file: "examples/intents/evm_transfer.json",
    chainKind: 1,
    chain: "evm_1559",
    template: "send {2:10^18} ETH to {1} (nonce {0})",
    defaultForChain: false,
  },
  {
    id: "evm_transfer_sepolia_v1",
    file: "examples/intents/evm_transfer_sepolia.json",
    chainKind: 1,
    chain: "evm_1559",
    template: "send {2:10^18} ETH to {1} (nonce {0})",
    defaultForChain: true,
  },
  {
    id: "erc20_transfer_mainnet_v1",
    file: "examples/intents/erc20_transfer.json",
    chainKind: 4,
    chain: "evm_1559_erc20",
    template: "transfer {3} of token {1} to {2} (nonce {0})",
    defaultForChain: false,
  },
  {
    id: "erc20_transfer_sepolia_v1",
    file: "examples/intents/erc20_transfer_sepolia.json",
    chainKind: 4,
    chain: "evm_1559_erc20",
    template: "transfer {3} of token {1} to {2} (nonce {0})",
    defaultForChain: true,
  },
  {
    id: "bitcoin_p2wpkh_transfer_v1",
    file: "examples/intents/btc_transfer.json",
    chainKind: 2,
    chain: "bitcoin_p2wpkh",
    template: "send {5:10^8} BTC to bc1q-pkh:0x{4} from utxo 0x{0}:{1}; return change to bc1q-pkh:0x{6}; fee {7} sats",
    defaultForChain: true,
  },
  {
    id: "zcash_transparent_transfer_v1",
    file: "examples/intents/zcash_transfer.json",
    chainKind: 3,
    chain: "zcash_transparent",
    template: "send {5:10^8} ZEC to pkh:{4} (input {0}:{1})",
    defaultForChain: true,
  },
  {
    id: "hyperliquid_transfer_v1",
    file: "examples/intents/hyperliquid_transfer.json",
    chainKind: 5,
    chain: "hyperliquid_evm",
    template: "send {2:10^18} HYPE to {1} (nonce {0})",
    defaultForChain: true,
  },
] as const;

export type IntentTemplateId = (typeof INTENT_TEMPLATES)[number]["id"];

export function templateFileForChainKind(chainKind: number): string {
  const registered = INTENT_TEMPLATES.find(
    (entry) => entry.chainKind === chainKind && entry.defaultForChain,
  );
  if (!registered) {
    throw new Error(`No default intent template for chainKind ${chainKind}`);
  }
  return registered.file;
}

export function templateFileForId(id: IntentTemplateId): string {
  const registered = INTENT_TEMPLATES.find((entry) => entry.id === id);
  if (!registered) {
    throw new Error(`Unknown intent template ${id}`);
  }
  return registered.file;
}
