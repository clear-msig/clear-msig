"use client";

// Propose-a-transaction flow . the demo-worthy page.
//
// UX:
//   1. User picks a wallet + an intent (by index) from a dropdown
//      populated directly from Solana RPC.
//   2. Form renders one typed input per param, with a live preview of
//      the rendered template and the exact bytes the wallet will sign.
//   3. User clicks "Sign with wallet" → `wallet.signMessage(bytes)` →
//      POST to relayer → toast with explorer link.
//
// Everything is computed client-side (`encodeParams`, `buildSignableMessage`)
// so the preview updates the instant you type, with no network round
// trips until the final submit. The backend is just a relayer.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { CardShell } from "@/components/ui/CardShell";
import { TypedParamInput } from "@/components/proposals/TypedParamInput";
import { SignablePreview } from "@/components/proposals/SignablePreview";
import { useIntentWorkflow } from "@/lib/hooks/useIntentWorkflow";
import { useProposalWorkflow } from "@/lib/hooks/useProposalWorkflow";
import { useSignWithWallet, WalletSignError } from "@/lib/hooks/useSignWithWallet";
import { useToast } from "@/components/ui/Toast";
import {
  buildSignableMessage,
  encodeParams,
  IntentType,
  toHex,
  type IntentAccount,
} from "@/lib/msig";
import { backendApi } from "@/lib/api/endpoints";

const DEFAULT_EXPIRY_WINDOW_SECS = 5 * 60; // 5 min . matches CLI default

export function ProposalCard({ walletName }: { walletName: string }) {
  const toast = useToast();

  // Pull the wallet's intent table directly from chain. Only custom
  // intents (index 3+) can be proposed against.
  const intents = useIntentWorkflow(walletName);
  const customIntents = useMemo(() => {
    const list = intents.listQuery.data ?? [];
    return list.filter((i) => i.account && i.account.intentType === IntentType.Custom && i.account.approved);
  }, [intents.listQuery.data]);

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // Auto-select the first available custom intent so the empty state
  // isn't sticky when the wallet has exactly one intent.
  useEffect(() => {
    if (selectedIndex === null && customIntents.length > 0) {
      setSelectedIndex(customIntents[0].index);
    }
  }, [customIntents, selectedIndex]);

  const selectedIntent = useMemo(
    () =>
      customIntents.find((i) => i.index === selectedIndex)?.account as
        | IntentAccount
        | undefined,
    [customIntents, selectedIndex]
  );

  // Per-param inputs, keyed by param name.
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  useEffect(() => {
    setParamValues({}); // reset form when switching intents
  }, [selectedIndex]);

  const paramNames = useMemo(() => {
    if (!selectedIntent) return [];
    return selectedIntent.params.map((p) => {
      const n = new TextDecoder().decode(
        selectedIntent.bytePool.subarray(p.nameOffset, p.nameOffset + p.nameLen)
      );
      return { name: n, type: p.paramType };
    });
  }, [selectedIntent]);

  // Decimal-shift hints from the template (`{N:10^18}` → decimals on
  // that param). Parsed once per intent.
  const paramDecimalHints = useMemo(() => {
    if (!selectedIntent) return new Map<number, number>();
    return extractDecimalHints(selectedIntent.template);
  }, [selectedIntent]);

  // Build the signable message client-side every keystroke. Expiry is
  // a stable value for the lifetime of this form render . it commits
  // at Sign time.
  const [expiryUnix] = useState(() =>
    Math.floor(Date.now() / 1000) + DEFAULT_EXPIRY_WINDOW_SECS
  );

  const previewState = useMemo(() => {
    if (!selectedIntent) return { status: "empty" as const };
    try {
      const paramsData = encodeParams(selectedIntent, paramValues);
      // Wallet + proposal index come from the underlying on-chain wallet.
      const walletAccount = intents.listQuery.data?.[0]?.account?.wallet; // intent's `wallet` field points at the wallet PDA . any intent will do.
      const walletInfo = {
        name: walletName,
        // We don't need the proposal_index from chain for preview . the
        // message format uses the *current* proposal_index as a nonce.
        // For preview purposes we use the wallet's next index (if we've
        // fetched it) or 0. It commits at submit time.
        proposalIndex: 0,
      };
      const built = buildSignableMessage({
        action: "propose",
        expiry: expiryUnix,
        walletName: walletInfo.name,
        proposalIndex: walletInfo.proposalIndex,
        intent: {
          intentType: IntentType.Custom,
          template: selectedIntent.template,
          params: selectedIntent.params,
          bytePool: selectedIntent.bytePool,
        },
        paramsData,
      });
      void walletAccount;
      return {
        status: "ok" as const,
        paramsData,
        body: built.body,
        bodyText: built.bodyText,
        wrapped: built.wrapped,
        messageHex: toHex(built.wrapped),
      };
    } catch (err) {
      return {
        status: "error" as const,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [
    selectedIntent,
    paramValues,
    walletName,
    expiryUnix,
    intents.listQuery.data,
  ]);

  // ── submit ─────────────────────────────────────────────────────────

  const { signBytes, canSign } = useSignWithWallet();
  const proposalWorkflow = useProposalWorkflow(walletName, "");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (previewState.status !== "ok" || selectedIndex === null) return;
    setSubmitting(true);
    try {
      const { signer_pubkey, signature } = await signBytes(previewState.wrapped);
      const res = await backendApi.submit.createProposal(walletName, {
        intent_index: selectedIndex,
        params_data_hex: toHex(previewState.paramsData),
        expiry: expiryUnix,
        signer_pubkey,
        signature,
      });
      toast.success("Proposal submitted", {
        link: explorerLink(res),
        details:
          "Approvers can now sign on the proposal detail page. The tx was paid by the relayer's sponsored-gas keypair.",
      });
      await proposalWorkflow.listQuery.refetch();
      setParamValues({});
    } catch (err) {
      if (err instanceof WalletSignError) {
        toast.error(
          err.code === "rejected"
            ? "Wallet rejected the signature"
            : err.message
        );
      } else {
        toast.error(
          err instanceof Error ? err.message : "Submit failed, see details",
          { details: describeError(err) }
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <CardShell
      title="Create Proposal"
      subtitle="Sign a human-readable intent. The bytes below are what your wallet hashes."
    >
      <motion.div
        className="flex flex-col gap-5"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        {/* Intent selector — wallet name comes in via prop now that this
            component is embedded in the wallet detail page. */}
        <LabelledField label="Intent">
          <IntentPicker
            intents={customIntents}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            loading={intents.listQuery.isLoading}
          />
        </LabelledField>

        {selectedIntent ? (
          <>
            {/* Rendered template . a friendly preview before hex. */}
            <IntentSummary intent={selectedIntent} />

            {/* Typed inputs. */}
            <div className="grid gap-3 sm:grid-cols-2">
              {paramNames.map((p, i) => (
                <TypedParamInput
                  key={p.name + i}
                  name={p.name}
                  type={p.type}
                  value={paramValues[p.name] ?? ""}
                  decimals={paramDecimalHints.get(i)}
                  unitHint={unitHintForIntent(selectedIntent, i)}
                  onChange={(v) =>
                    setParamValues((prev) => ({ ...prev, [p.name]: v }))
                  }
                />
              ))}
            </div>

            {/* Live preview. The `context` strip surfaces the multisig +
                multi-chain narrative right above the bytes the wallet
                will sign — so the signer always sees what wallet they
                are speaking for, on which chain, and toward what action,
                not just the body text. */}
            <SignablePreview
              bodyText={previewState.status === "ok" ? previewState.bodyText : null}
              messageHex={previewState.status === "ok" ? previewState.messageHex : null}
              context={{
                action: "propose",
                wallet: walletName,
                chain: selectedIntent ? chainKindLabel(selectedIntent.chainKind) : undefined,
                threshold: selectedIntent
                  ? {
                      current: 0,
                      total: selectedIntent.approvers.length,
                    }
                  : undefined,
              }}
              statusChip={
                previewState.status === "error" ? (
                  <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-300">
                    fill params
                  </span>
                ) : null
              }
            />

            {/* Sign button . disabled until the message builds cleanly. */}
            <button
              disabled={previewState.status !== "ok" || submitting || !canSign}
              onClick={submit}
              className="group relative inline-flex items-center justify-center gap-2 rounded-2xl bg-brand-green px-5 py-3.5 text-sm font-bold text-black shadow-glow transition-all hover:bg-emerald-300 hover:shadow-glow-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Signing & relaying…
                </>
              ) : (
                <>
                  <ShieldCheck size={16} />
                  Sign with wallet & submit
                  <ChevronRight size={16} className="transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>
            {/* Inline reason text under the sign button — replaces the
                old behaviour of silently disabling without explanation. */}
            {!canSign ? (
              <span className="-mt-2 text-xs text-amber-300">
                Connect a wallet that supports signMessage (Phantom, Solflare, Backpack).
              </span>
            ) : previewState.status === "error" ? (
              <span className="-mt-2 text-xs text-amber-300">
                {previewState.error ?? "Fill in every parameter to build the message."}
              </span>
            ) : previewState.status !== "ok" ? (
              <span className="-mt-2 text-xs text-text-muted">
                Loading preview…
              </span>
            ) : null}
          </>
        ) : (
          <EmptyState walletName={walletName} loading={intents.listQuery.isLoading} />
        )}
      </motion.div>
    </CardShell>
  );
}

// ── sub-pieces ────────────────────────────────────────────────────────

function LabelledField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

function IntentPicker({
  intents,
  selectedIndex,
  onSelect,
  loading,
}: {
  intents: ReturnType<typeof useIntentWorkflow>["listQuery"]["data"] extends infer T
    ? T extends { account: IntentAccount | null }[]
      ? T
      : never
    : never;
  selectedIndex: number | null;
  onSelect: (i: number) => void;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex h-[42px] items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-text-muted">
        <Loader2 size={12} className="animate-spin" /> Loading intents from chain…
      </div>
    );
  }
  if (!intents || intents.length === 0) {
    return (
      <div className="flex h-[42px] items-center rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-text-muted">
        No custom intents yet. Add one on the Intents tab first.
      </div>
    );
  }
  return (
    <select
      value={selectedIndex ?? ""}
      onChange={(e) => onSelect(Number(e.target.value))}
      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-brand-white outline-none transition-colors focus:border-brand-green/50 focus:bg-white/10"
    >
      <option value="" disabled>
        Pick an intent…
      </option>
      {intents.map((i) =>
        i.account ? (
          <option key={i.index} value={i.index} className="bg-black text-white">
            {`#${i.index} · ${i.account.template || "(no template)"}`}
          </option>
        ) : null
      )}
    </select>
  );
}

function IntentSummary({ intent }: { intent: IntentAccount }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-brand-green">
        <Sparkles size={12} /> Template
      </div>
      <p className="mt-2 font-mono text-sm text-white/90">{intent.template}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
        <Chip>
          chain · <b>{chainKindLabel(intent.chainKind)}</b>
        </Chip>
        <Chip>
          threshold · <b>{intent.approvalThreshold}/{intent.approvers.length}</b>
        </Chip>
        {intent.timelockSeconds > 0 && (
          <Chip>
            timelock · <b>{intent.timelockSeconds}s</b>
          </Chip>
        )}
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-white/70">
      {children}
    </span>
  );
}

function EmptyState({
  walletName,
  loading,
}: {
  walletName: string;
  loading: boolean;
}) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center"
      >
        <p className="text-sm text-text-muted">
          {loading
            ? "Loading intents…"
            : `No custom intents on “${walletName}” yet.`}
        </p>
        {!loading && (
          <Link
            href="/app/intents"
            className="mt-3 inline-flex items-center gap-1 rounded-full bg-brand-green/15 px-3 py-1.5 text-xs font-semibold text-brand-green hover:bg-brand-green/25"
          >
            Add a custom intent <ChevronRight size={12} />
          </Link>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

// ── helpers ───────────────────────────────────────────────────────────

function extractDecimalHints(template: string): Map<number, number> {
  const out = new Map<number, number>();
  const re = /\{(\d+):10\^(\d+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    out.set(Number(m[1]), Number(m[2]));
  }
  return out;
}

function unitHintForIntent(intent: IntentAccount, paramIdx: number): string | undefined {
  // Heuristic unit labels for the decimal-shift preview. Keeps the
  // UI helpful without hard-coding chain semantics into the lib.
  const name = new TextDecoder()
    .decode(
      intent.bytePool.subarray(
        intent.params[paramIdx].nameOffset,
        intent.params[paramIdx].nameOffset + intent.params[paramIdx].nameLen
      )
    )
    .toLowerCase();
  if (name.includes("wei") || name.includes("eth")) return "ETH";
  if (name.includes("lamport") || name.includes("sol")) return "SOL";
  if (name.includes("sat")) return "BTC";
  if (name.includes("zat") || name.includes("zec")) return "ZEC";
  return undefined;
}

function chainKindLabel(k: number): string {
  switch (k) {
    case 0:
      return "solana";
    case 1:
      return "evm_1559";
    case 2:
      return "bitcoin_p2wpkh";
    case 3:
      return "zcash";
    case 4:
      return "evm_1559_erc20";
    default:
      return `chain_${k}`;
  }
}

function explorerLink(
  res: Record<string, unknown>
): { label: string; href: string } | undefined {
  const txid = res.txid as string | undefined;
  if (!txid) return;
  return {
    label: `tx ${txid.slice(0, 8)}…`,
    href: `https://explorer.solana.com/tx/${txid}?cluster=devnet`,
  };
}

function describeError(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { payload?: Record<string, unknown> };
  if (!e.payload) return undefined;
  try {
    return JSON.stringify(e.payload, null, 2);
  } catch {
    return undefined;
  }
}
