let held = false;
let pendingProviderOperations = 0;
/** A UI timeout cannot cancel a provider promise. Retain exclusion until it settles. */
export function trackProviderSigning<T>(operation: Promise<T>): Promise<T> {
  pendingProviderOperations += 1;
  return operation.finally(() => { pendingProviderOperations -= 1; });
}
/** Shared across hook instances, including the period while the wallet is open. */
export async function withSigningLock<T>(operation: () => Promise<T>): Promise<T> {
  if (held || pendingProviderOperations > 0) throw new Error("Finish or cancel the current signing request before starting another.");
  held = true;
  try { return await operation(); } finally { held = false; }
}
