let held = false;
/** Shared across hook instances, including the period while the wallet is open. */
export async function withSigningLock<T>(operation: () => Promise<T>): Promise<T> {
  if (held) throw new Error("Finish or cancel the current signing request before starting another.");
  held = true;
  try { return await operation(); } finally { held = false; }
}
