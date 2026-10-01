import { PublicKey } from "@solana/web3.js";
import type { SavedSend } from "../domain/sendRecovery";
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
/** Public request IDs only. A lost response is not evidence that submission failed. */
export class SendRecovery {
  private running = false;
  private currentScope: string;
  private scopeVersion = 0;
  private mounted = true;
  private memory = new Map<string, SavedSend>();
  constructor(
    scope: string,
    private storage?: StorageLike,
    private changed = () => {},
  ) {
    this.currentScope = scope;
  }
  scope(scope: string) {
    if (scope !== this.currentScope) this.scopeVersion += 1;
    this.currentScope = scope;
  }
  mount() {
    this.mounted = true;
  }
  unmount() {
    this.mounted = false;
    this.scopeVersion += 1;
  }
  private key(scope: string) {
    return `clearsig:send-recovery:v1:${scope}`;
  }
  saved(scope = this.currentScope): SavedSend | null {
    if (this.memory.has(scope)) return this.memory.get(scope)!;
    try {
      const data = JSON.parse(
        this.storage?.getItem(this.key(scope)) ?? "null",
      ) as SavedSend | null;
      if (
        data &&
        (data.outcome === "submitted" || data.outcome === "unknown") &&
        new PublicKey(data.proposal).toBase58() === data.proposal
      ) {
        this.memory.set(scope, data);
        return data;
      }
    } catch {
      /* malformed/unavailable session storage cannot authorize a send */
    }
    return null;
  }
  startSeparateRequest() {
    if (this.running) throw new Error("Wait for the current send to finish.");
    this.memory.delete(this.currentScope);
    try {
      this.storage?.removeItem(this.key(this.currentScope));
    } catch {
      /* memory remains authoritative in this tab */
    }
    this.changed();
  }
  begin() {
    if (!this.mounted)
      throw new Error(
        "The send page has closed. Review the existing request before retrying.",
      );
    const scope = this.currentScope;
    const version = this.scopeVersion;
    if (this.running) throw new Error("A send is already in progress.");
    if (this.saved(scope))
      throw new Error(
        "Review the existing request before starting another send.",
      );
    this.running = true;
    let finished = false;
    const assertCurrent = () => {
      if (
        !this.mounted ||
        finished ||
        scope !== this.currentScope ||
        version !== this.scopeVersion
      )
        throw new Error(
          "Wallet or network changed. The previous send was stopped; review its request before retrying.",
        );
    };
    const save = (proposal: string, outcome: SavedSend["outcome"]) => {
      const entry = { proposal: new PublicKey(proposal).toBase58(), outcome };
      this.memory.set(scope, entry);
      try {
        this.storage?.setItem(this.key(scope), JSON.stringify(entry));
      } catch {
        /* retain in memory */
      }
      this.changed();
    };
    return {
      assertCurrent,
      submitting: (proposal: string) => {
        assertCurrent();
        save(proposal, "unknown");
      },
      accepted: (proposal: string) => {
        save(proposal, "submitted");
        assertCurrent();
      },
      complete: () => {
        assertCurrent();
        this.memory.delete(scope);
        try {
          this.storage?.removeItem(this.key(scope));
        } catch {
          /* retain UI truth */
        }
        this.changed();
      },
      finish: () => {
        finished = true;
        this.running = false;
        this.changed();
      },
    };
  }
}
