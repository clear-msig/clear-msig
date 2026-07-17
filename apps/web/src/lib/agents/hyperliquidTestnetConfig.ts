export interface HyperliquidTestnetExecutorConfig {
  accountAddress: string;
  agentWalletAddress: string;
  executorUrl: string;
  executorToken: string;
}

export function readHyperliquidTestnetExecutorConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): { config: HyperliquidTestnetExecutorConfig | null; errors: string[] } {
  const errors: string[] = [];
  const accountAddress =
    env.CLEARSIG_HYPERLIQUID_TESTNET_ACCOUNT_ADDRESS?.trim() ?? "";
  const executorUrl =
    env.CLEARSIG_HYPERLIQUID_TESTNET_EXECUTOR_URL?.trim() ?? "";
  const executorToken =
    env.CLEARSIG_HYPERLIQUID_TESTNET_EXECUTOR_TOKEN?.trim() ?? "";
  const agentWalletAddress =
    env.CLEARSIG_HYPERLIQUID_TESTNET_AGENT_WALLET_ADDRESS?.trim() ?? "";

  if (!isEvmAddress(accountAddress)) {
    errors.push("Hyperliquid testnet account address is missing or invalid.");
  }
  if (!isEvmAddress(agentWalletAddress)) {
    errors.push("Hyperliquid testnet API wallet address is missing or invalid.");
  }
  if (
    isEvmAddress(accountAddress) &&
    isEvmAddress(agentWalletAddress) &&
    accountAddress.toLowerCase() === agentWalletAddress.toLowerCase()
  ) {
    errors.push("Hyperliquid testnet API wallet must be separate from the funded account.");
  }
  if (!isHttpUrl(executorUrl)) {
    errors.push("Hyperliquid testnet executor URL is missing or invalid.");
  }
  if (!executorToken || executorToken.length > 500) {
    errors.push("Hyperliquid testnet executor token is missing or invalid.");
  }
  if (errors.length > 0) return { config: null, errors };

  return {
    config: {
      accountAddress: accountAddress.toLowerCase(),
      agentWalletAddress: agentWalletAddress.toLowerCase(),
      executorUrl: executorUrl.replace(/\/+$/, ""),
      executorToken,
    },
    errors: [],
  };
}

function isEvmAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isHttpUrl(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
