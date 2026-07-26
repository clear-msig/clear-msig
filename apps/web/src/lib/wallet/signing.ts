export const WALLET_SIGNATURE_TIMEOUT_MS = 60_000;

export class WalletSignatureTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Wallet did not respond within ${Math.round(timeoutMs / 1000)} seconds`);
    this.name = "WalletSignatureTimeoutError";
  }
}

export function withWalletSignatureTimeout<T>(
  signing: Promise<T>,
  timeoutMs = WALLET_SIGNATURE_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new WalletSignatureTimeoutError(timeoutMs)),
      timeoutMs,
    );
    signing.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
