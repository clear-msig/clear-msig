import type { Connection, PublicKey } from "@solana/web3.js";
import { currentWalletPolicyCommitment } from "@/lib/policies/persistentWalletPolicy";

// Include raw authoring data: an evaluation result alone can stay unchanged
// when policy changes. Missing/unreadable storage must not authorize a review.
const keys = ["clear.policies.v1", "clear-msig:spending-budget:v1",
  "clear-msig:policy.allowlist:v1", "clear-msig:policy.timeWindow:v1",
  "clear-msig:allowances:v1"];
const events = ["clear:policies-changed", "clear:spending-budget-changed", "clear:personal-policy-changed"];

function localSnapshot(): string {
  if (typeof window === "undefined") return "server";
  return JSON.stringify(keys.map((key) => window.localStorage.getItem(key)));
}

/** Conservative across wallets; a policy edit requires another explicit review. */
export function subscribeSendPolicyChanges(invalidate: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const storage = (event: StorageEvent) => {
    if (event.key === null || keys.includes(event.key)) invalidate();
  };
  window.addEventListener("storage", storage);
  for (const event of events) window.addEventListener(event, invalidate);
  return () => {
    window.removeEventListener("storage", storage);
    for (const event of events) window.removeEventListener(event, invalidate);
  };
}

export async function captureSolanaPolicyReview(connection: Connection, wallet: PublicKey) {
  const local = localSnapshot();
  let invalidated = false;
  const dispose = subscribeSendPolicyChanges(() => { invalidated = true; });
  const assertLocal = () => {
    if (invalidated || localSnapshot() !== local)
      throw new Error("Wallet protection changed. Review a newly prepared request before signing.");
  };
  try {
    const commitment = await currentWalletPolicyCommitment(connection, wallet, 0);
    assertLocal();
    return {
      dispose,
      commitment,
      async assertCurrent() {
        assertLocal();
        const current = await currentWalletPolicyCommitment(connection, wallet, 0);
        assertLocal();
        if (current !== commitment) {
          invalidated = true;
          throw new Error("Active wallet protection changed. Review a newly prepared request before signing.");
        }
      },
    };
  } catch (error) { dispose(); throw error; }
}
