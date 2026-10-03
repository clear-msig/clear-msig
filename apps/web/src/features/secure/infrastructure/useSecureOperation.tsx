"use client";
import { useEffect, useReducer, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useWallet, useConnection } from "@/lib/wallet";
import { useRequestIdentity } from "@/lib/hooks/useRequestIdentity";
import { createSecureOperation, SecureOperationError, type SecureReceipt, type ReceiptStore } from "@/lib/ikavery/transactionOperation";

const STORAGE_KEY = "clear:secure-transaction-recovery:v1";
const CHANGED = "clear:secure-recovery-changed";
const store: ReceiptStore = {
  read() {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(raw) || raw.some(r => !r || typeof r.signature !== "string" || typeof r.genesis !== "string" || typeof r.signer !== "string" || typeof r.action !== "string" || typeof r.operation !== "string" || typeof r.complete !== "boolean" || !["unknown", "confirmed", "failed"].includes(r.status)))
      throw new SecureOperationError("Secure recovery records could not be read. Preserve browser storage and check existing transactions before retrying.");
    return raw;
  },
  write(receipts) {
    // Completed records are no longer needed for interrupted-operation recovery.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(receipts.filter(r => !r.complete)));
    window.dispatchEvent(new Event(CHANGED));
  },
};

export function useSecureOperation(scope: string) {
  const identity = useRequestIdentity();
  const wallet = useWallet();
  const { connection } = useConnection();
  const pathname = usePathname();
  const key = JSON.stringify([scope, pathname, wallet.connected, wallet.publicKey?.toBase58(), wallet.dynamicPublicKey?.toBase58(), wallet.ledgerPublicKey?.toBase58(), wallet.isLedger]);
  const lifetime = useRef({ key, revision: 0 });
  if (lifetime.current.key !== key) { lifetime.current.key = key; lifetime.current.revision += 1; }
  const revision = lifetime.current.revision;
  const [, refreshRevision] = useReducer((value: number) => value + 1, 0);
  const [receipts, setReceipts] = useState<SecureReceipt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const checkBusy = useRef(false);
  const running = useRef(new Set<string>());
  useEffect(() => {
    const reload = () => {
      try { setReceipts(store.read().filter(r => r.signer === wallet.publicKey?.toBase58())); setError(null); }
      catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    };
    reload(); window.addEventListener(CHANGED, reload); window.addEventListener("storage", reload);
    const invalidate = () => { lifetime.current.revision += 1; refreshRevision(); };
    window.addEventListener("popstate", invalidate);
    return () => { window.removeEventListener(CHANGED, reload); window.removeEventListener("storage", reload); window.removeEventListener("popstate", invalidate); };
  }, [wallet.publicKey]);

  async function run<T>(action: string, work: (operation: ReturnType<typeof createSecureOperation>) => Promise<T>, additionalApproval = false): Promise<T> {
    const request = identity.capture();
    const assertCurrent = () => {
      request.assertCurrent();
      if (revision !== lifetime.current.revision || !wallet.connected) throw new SecureOperationError("Account, route or Secure settings changed. Prepare and review again.");
    };
    assertCurrent();
    if (!wallet.publicKey || !wallet.signTransaction) throw new SecureOperationError("Connect a transaction-capable Solana wallet.");
    // Additional votes may legitimately run while the parent workflow awaits them.
    // They share the provider lock, but must not be blocked by the parent's receipt.
    if (running.current.has(action)) throw new SecureOperationError("This Secure operation is already running.");
    if (store.read().some(r => r.signer === wallet.publicKey?.toBase58() && !r.complete && (!additionalApproval || !running.current.size)))
      throw new SecureOperationError("Check the Secure recovery notice before starting another operation.");
    const operationId = crypto.randomUUID();
    const operation = createSecureOperation({ connection, signer: wallet.publicKey, signTransaction: wallet.signTransaction, action, assertCurrent, store, operationId,
      review: async (document, guard) => {
        const { requestPreparedSigningReview } = await import("@/lib/clearsign/preparedSigningReview");
        guard();
        await requestPreparedSigningReview({document, label: "Secure transaction", signer: wallet.publicKey!.toBase58(), assertCurrent: guard});
      },
    });
    running.current.add(action);
    try { const result = await work(operation); operation.complete(); return result; }
    catch (e) { throw operation.failure(e); }
    finally { running.current.delete(action); }
  }
  async function check() {
    if (checkBusy.current) return;
    checkBusy.current = true; setChecking(true);
    try {
      const request = identity.capture();
      const genesis = await connection.getGenesisHash(); request.assertCurrent();
      const current = store.read();
      const matching = current.filter(r => r.signer === wallet.publicKey?.toBase58() && r.genesis === genesis);
      if (!matching.length) throw new Error("These transactions belong to another network. Switch to the original network to check them.");
      const { value } = await connection.getSignatureStatuses(matching.map(r => r.signature), {searchTransactionHistory: true}); request.assertCurrent();
      const statuses = new Map(matching.map((r, i) => [r.signature, value[i]?.confirmationStatus === "confirmed" || value[i]?.confirmationStatus === "finalized" ? value[i]?.err ? "failed" as const : "confirmed" as const : "unknown" as const]));
      store.write(current.map(r => statuses.has(r.signature) ? {...r, status: statuses.get(r.signature)!} : r));
    } catch(e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { checkBusy.current = false; setChecking(false); }
  }
  function acknowledge() {
    try {
      if (running.current.size) throw new Error("Wait for the current operation to finish.");
      const current = store.read();
      const mine = current.filter(r => r.signer === wallet.publicKey?.toBase58());
      if (mine.some(r => r.status === "unknown")) throw new Error("An outcome is still unknown. Do not retry the operation.");
      store.write(current.filter(r => r.signer !== wallet.publicKey?.toBase58()));
    } catch(e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  return {run, receipts, error, checking, check, acknowledge};
}

export function SecureRecoveryNotice({recovery}: {recovery: ReturnType<typeof useSecureOperation>}) {
  if (!recovery.receipts.length && !recovery.error) return null;
  return <section role="status" className="mx-gutter rounded-card border border-border-soft bg-surface-raised p-4 text-sm text-text-strong">
    <h2 className="font-semibold">Secure transaction recovery</h2>
    <p>These steps may already be on chain. Check each outcome and the existing vault before restarting. An unknown outcome is not a failed transaction.</p>
    {recovery.receipts.map(r => <p key={r.signature} className="mt-2 break-all">{r.action}: {r.status}<br/><span className="font-mono">{r.signature}</span></p>)}
    {recovery.error && <p role="alert">{recovery.error}</p>}
    <button type="button" className="mt-3 min-h-11 rounded-soft border border-border-soft px-3" disabled={recovery.checking} onClick={()=>void recovery.check()}>{recovery.checking ? "Checking…" : "Check on-chain status"}</button>
    {!!recovery.receipts.length && recovery.receipts.every(r => r.status !== "unknown") && <button type="button" className="ml-3 mt-3 min-h-11 rounded-soft border border-border-soft px-3" onClick={recovery.acknowledge}>I checked these outcomes and the vault</button>}
  </section>;
}
