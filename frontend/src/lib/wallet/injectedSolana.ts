import { PublicKey, type Transaction, type VersionedTransaction } from "@solana/web3.js";

type SolanaTransaction = Transaction | VersionedTransaction;
type SolanaMessageSignature = Uint8Array | { signature?: Uint8Array };

type InjectedSolanaProvider = {
  isBackpack?: boolean;
  isPhantom?: boolean;
  isSolflare?: boolean;
  publicKey?: { toString(): string };
  signMessage?: (
    bytes: Uint8Array,
    display?: "utf8",
  ) => Promise<SolanaMessageSignature>;
  signTransaction?: <T extends SolanaTransaction>(tx: T) => Promise<T>;
};

type InjectedProviderCandidate = {
  source: "backpack" | "phantom" | "solana" | "solflare";
  provider: InjectedSolanaProvider | undefined;
};

function candidates(connectorKey: string): InjectedProviderCandidate[] {
  if (typeof window === "undefined") return [];
  const w = window as unknown as {
    backpack?: InjectedSolanaProvider;
    phantom?: { solana?: InjectedSolanaProvider };
    solana?: InjectedSolanaProvider;
    solflare?: InjectedSolanaProvider;
  };
  if (/solflare/.test(connectorKey)) {
    return [
      { source: "solflare", provider: w.solflare },
      { source: "solana", provider: w.solana },
    ];
  }
  if (/phantom/.test(connectorKey)) {
    return [
      { source: "phantom", provider: w.phantom?.solana },
      { source: "solana", provider: w.solana },
    ];
  }
  if (/backpack/.test(connectorKey)) {
    return [
      { source: "backpack", provider: w.backpack },
      { source: "solana", provider: w.solana },
    ];
  }
  return [
    { source: "solana", provider: w.solana },
    { source: "solflare", provider: w.solflare },
    { source: "phantom", provider: w.phantom?.solana },
    { source: "backpack", provider: w.backpack },
  ];
}

function matches(candidate: InjectedProviderCandidate, connectorKey: string) {
  const { provider, source } = candidate;
  if (!provider) return false;
  if (/solflare/.test(connectorKey)) {
    return source === "solflare" || provider.isSolflare === true;
  }
  if (/phantom/.test(connectorKey)) {
    return source === "phantom" || provider.isPhantom === true;
  }
  if (/backpack/.test(connectorKey)) {
    return source === "backpack" || provider.isBackpack === true;
  }
  return true;
}

export async function signTransactionWithInjectedProvider<T extends SolanaTransaction>({
  connectorKey,
  expectedPublicKey,
  transaction,
}: {
  connectorKey: string;
  expectedPublicKey: PublicKey | null;
  transaction: T;
}): Promise<T | null> {
  const expected = expectedPublicKey?.toBase58();
  if (!expected) return null;
  for (const candidate of candidates(connectorKey)) {
    const { provider } = candidate;
    if (!provider?.signTransaction || !matches(candidate, connectorKey)) continue;
    if (provider.publicKey?.toString() !== expected) continue;
    return provider.signTransaction(transaction);
  }
  return null;
}

export async function signMessageWithInjectedProvider({
  connectorKey,
  expectedPublicKey,
  bytes,
}: {
  connectorKey: string;
  expectedPublicKey: PublicKey | null;
  bytes: Uint8Array;
}): Promise<Uint8Array | null> {
  const expected = expectedPublicKey?.toBase58();
  if (!expected) return null;
  for (const candidate of candidates(connectorKey)) {
    const { provider } = candidate;
    if (!provider?.signMessage || !matches(candidate, connectorKey)) continue;
    if (provider.publicKey?.toString() !== expected) continue;
    const result = await provider.signMessage(bytes, "utf8");
    if (result instanceof Uint8Array) return result;
    if (result.signature instanceof Uint8Array) return result.signature;
    throw new Error("Wallet returned an unexpected signMessage shape");
  }
  return null;
}
