import { PublicKey } from "@solana/web3.js";
import { sha256, toHex } from "@/lib/msig/hash";
import { savedProposalError } from "./inlineApproval";
export type SavedRequest = Readonly<{
  key: string;
  accountKey: string;
  walletName: string;
  endpoint: string;
  label: string;
  proposal: string;
  outcome: "unknown" | "submitted";
  phase?: "execution";
  txid?: string;
}>;
type StorageLike = Pick<Storage, "getItem" | "setItem">;
const STORAGE_KEY = "clearsig:canonical-request-recovery:v1";
const EMPTY: readonly SavedRequest[] = [];
/** Recovery metadata only; it never authorizes or executes a transaction. */
export class RequestRecoveryStore {
  private entries: readonly SavedRequest[] = EMPTY;
  private loaded = false;
  private running = new Set<string>();
  private listeners = new Set<() => void>();
  constructor(private storage?: StorageLike) {}
  snapshot = (): readonly SavedRequest[] => {
    if (!this.loaded) {
      this.loaded = true;
      try {
        const values: unknown = JSON.parse(
          this.storage?.getItem(STORAGE_KEY) ?? "[]",
        );
        if (Array.isArray(values))
          this.entries = values
            .slice(0, 100)
            .filter((v): v is SavedRequest => {
              if (
                !v ||
                typeof v !== "object" ||
                !/^[0-9a-f]{64}$/.test(v.key) ||
                !/^[0-9a-f]{64}$/.test(v.accountKey) ||
                typeof v.walletName !== "string" ||
                typeof v.endpoint !== "string" ||
                typeof v.label !== "string" ||
                !["unknown", "submitted"].includes(v.outcome) ||
                (v.phase !== undefined && v.phase !== "execution")
              )
                return false;
              try {
                return new PublicKey(v.proposal).toBase58() === v.proposal;
              } catch {
                return false;
              }
            })
            .map((entry) => {
              const txid =
                typeof entry.txid === "string" &&
                /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(entry.txid)
                  ? entry.txid
                  : undefined;
              return { ...entry, txid };
            });
      } catch {
        /* untrusted recovery metadata grants no authority */
      }
    }
    return this.entries;
  };
  serverSnapshot = () => EMPTY;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(entries: readonly SavedRequest[]) {
    this.entries = entries;
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      /* keep this tab's memory state */
    }
    this.listeners.forEach((listener) => listener());
  }
  acknowledgeSeparateRequest = (key: string) => {
    if (this.running.has(key))
      throw new Error("Wait for the current request to finish.");
    if (
      this.snapshot().some(
        (entry) => entry.key === key && entry.phase === "execution",
      )
    )
      throw new Error(
        "Execution may already have been submitted. Check its verified status; do not resubmit blindly.",
      );
    this.update(this.snapshot().filter((entry) => entry.key !== key));
  };
  executionFor = (endpoint: string, proposal: string) =>
    this.snapshot().find(
      (entry) =>
        entry.phase === "execution" &&
        entry.endpoint === endpoint &&
        entry.proposal === proposal,
    );
  resolveExecution = (endpoint: string, proposal: string) =>
    this.update(
      this.snapshot().filter(
        (entry) =>
          !(
            entry.phase === "execution" &&
            entry.endpoint === endpoint &&
            entry.proposal === proposal
          ),
      ),
    );
  begin(input: {
    walletName: string;
    endpoint: string;
    accountKey: string;
    label: string;
    identity: unknown;
    phase?: "execution";
  }) {
    const key = toHex(
      sha256(
        new TextEncoder().encode(
          JSON.stringify([
            input.walletName,
            input.endpoint,
            input.accountKey,
            input.identity,
          ]),
        ),
      ),
    );
    const saved = this.snapshot().find((entry) => entry.key === key);
    if (saved)
      throw savedProposalError(
        saved.proposal,
        new Error(
          "Review the existing request before submitting the same change again.",
        ),
        saved.outcome === "submitted",
      );
    if (this.running.has(key))
      throw new Error(
        "This change is already being prepared. Wait for its result.",
      );
    this.running.add(key);
    let finished = false;
    const save = (
      proposal: string,
      outcome: SavedRequest["outcome"],
      txid?: string,
    ) => {
      if (finished) throw new Error("This request attempt has ended.");
      new PublicKey(proposal);
      this.update([
        ...this.snapshot().filter((entry) => entry.key !== key),
        Object.freeze({
          key,
          accountKey: input.accountKey,
          walletName: input.walletName,
          endpoint: input.endpoint,
          label: input.label,
          proposal,
          outcome,
          ...(txid ? { txid } : {}),
          ...(input.phase ? { phase: input.phase } : {}),
        }),
      ]);
    };
    return {
      submitting: (proposal: string) => save(proposal, "unknown"),
      accepted: (proposal: string, txid?: string) =>
        save(proposal, "submitted", txid),
      complete: () =>
        this.update(this.snapshot().filter((entry) => entry.key !== key)),
      finish: () => {
        finished = true;
        this.running.delete(key);
      },
    };
  }
}
export const requestRecovery = new RequestRecoveryStore({
  getItem: (key) =>
    typeof window === "undefined" ? null : window.sessionStorage.getItem(key),
  setItem: (key, value) => {
    if (typeof window !== "undefined")
      window.sessionStorage.setItem(key, value);
  },
});
