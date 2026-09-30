export class ApprovalCollectionClosedError extends Error {
  constructor() {
    super("Approval collection closed. Any submitted proposal remains on chain.");
    this.name = "ApprovalCollectionClosedError";
  }
}

// Scope each gate to one route/vault. A late approval callback can only release
// the request it belongs to; navigation rejects the wait instead of retaining
// an orphaned flow that may execute after the user leaves.
export function createApprovalCollection(scope = "") {
  let active = false;
  let pending: { key: string; resolve: () => void; reject: (error: Error) => void } | null = null;
  return {
    open() { active = true; },
    close() {
      active = false;
      const waiting = pending;
      pending = null;
      waiting?.reject(new ApprovalCollectionClosedError());
    },
    wait(key: string): Promise<void> {
      if (!active) return Promise.reject(new ApprovalCollectionClosedError());
      if (pending) return Promise.reject(new Error("An approval request is already waiting."));
      return new Promise((resolve, reject) => { pending = { key: `${scope}:${key}`, resolve, reject }; });
    },
    complete(key: string) {
      if (!active || !pending || pending.key !== `${scope}:${key}`) return;
      const waiting = pending;
      pending = null;
      waiting.resolve();
    },
  };
}
