type SolanaMessageSignature = Uint8Array | { signature?: Uint8Array };

interface DynamicSolanaSignerLike {
  signMessage: (bytes: Uint8Array) => Promise<SolanaMessageSignature>;
}

interface BytePreservingConnectorLike {
  signUint8ArrayMessage?: (bytes: Uint8Array) => Promise<Uint8Array>;
}

export interface DynamicSolanaWalletLike {
  connector?: BytePreservingConnectorLike;
  signUint8ArrayMessage?: (bytes: Uint8Array) => Promise<Uint8Array>;
  getSigner?: () => Promise<DynamicSolanaSignerLike | undefined>;
}

/**
 * Signs exact Solana message bytes without changing Dynamic's primary wallet.
 *
 * Turnkey-backed social wallets expose their byte-preserving method on the
 * connector, not the Wallet wrapper. Calling Wallet.getSigner() first adds a
 * wallet.sync() step; that can wait forever when the user's primary embedded
 * chain is EVM. External wallets normally sign through the injected-provider
 * adapter before reaching this function, so the connector-first path is scoped
 * to Dynamic's embedded implementation.
 */
export async function signDynamicSolanaMessage(
  walletValue: unknown,
  bytes: Uint8Array,
): Promise<Uint8Array> {
  const wallet = walletValue as DynamicSolanaWalletLike;
  const connectorSigner = wallet.connector?.signUint8ArrayMessage;
  if (typeof connectorSigner === "function") {
    return connectorSigner.call(wallet.connector, bytes);
  }

  if (typeof wallet.signUint8ArrayMessage === "function") {
    return wallet.signUint8ArrayMessage(bytes);
  }

  const signer = await wallet.getSigner?.();
  if (!signer || typeof signer.signMessage !== "function") {
    throw new Error("This Solana wallet connector does not expose signMessage");
  }
  return normalizeMessageSignature(await signer.signMessage(bytes));
}

function normalizeMessageSignature(result: SolanaMessageSignature): Uint8Array {
  if (result instanceof Uint8Array) return result;
  if (result.signature instanceof Uint8Array) return result.signature;
  throw new Error("Wallet returned an unexpected signMessage shape");
}
