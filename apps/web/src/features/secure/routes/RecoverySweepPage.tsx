"use client";

// /app/secure/[recovery]/sweep. Full in-app sweep wizard.
//
// Three stages:
//   1. compose . Destination address + SOL amount.
//   2. review  . Preview card (from / to / amount / message size).
//   3. running . Runs propose+approve → execute → presign+sign →
//                 broadcast in sequence, with live progress dots.
//   4. done    . Explorer pills for the proposal, execute, and the
//                 actual sweep broadcast.
//
// Two user popups: one for the propose+approve bundle, one for the
// execute. The presign+sign step is a gRPC-Web round trip with no
// user interaction. Broadcast happens automatically once the network
// signature lands.
//
// Pre-conditions enforced by the action layer:
//   - the connected wallet is on the roster
//   - the saved DKG attestation includes `dwalletAddr` (new vaults do)
//   - vault threshold = 1
// Anything else fails fast with a useful message in the toast.

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import { useConnection, useWallet } from "@/lib/wallet";
import { Button } from "@/components/retail/Button";
import { PageEyebrow } from "@/components/retail/PageEyebrow";
import { useToast } from "@/components/ui/Toast";
import { fetchVault } from "@/lib/ikavery/clearmsig-actions";
import { loadAttestation } from "@/lib/ikavery/clearmsig-attestations";
import {
  buildSweepMessage,
  createIdempotentAta,
  deriveAta,
  prepareSplSweepTarget,
  transferSol,
  transferSplTokenChecked,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@/lib/ikavery/sweep/message";
import {
  addSweepApproval,
  runInAppSweep,
  type AdditionalApprovalsRequest,
  type SweepAuthMode,
  type SweepStage as ActionStage,
  type SweepTarget,
} from "@/lib/ikavery/clearmsig-sweep";
import { SCHEME_SOLANA_ADDRESS } from "@/lib/ikavery/constants";
import { decodeProposal } from "@/lib/ikavery/codec/proposal";
import { secureActionErrorCopy } from "@/lib/ikavery/errors";
import {
  ComposeStage,
  DoneStage,
  formatLamportsToSol,
  formatTokenAmount,
  ReviewStage,
  RunningStage,
  type SplHolding,
} from "@/features/secure/routes/RecoverySweepStages";

const KNOWN_DEVNET_SYMBOLS: Record<string, string> = {
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
};

async function fetchDwalletHoldings(
  connection: Connection,
  dwallet: PublicKey,
): Promise<SplHolding[]> {
  const out: SplHolding[] = [];
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const resp = await connection.getParsedTokenAccountsByOwner(
      dwallet,
      { programId },
      "confirmed",
    );
    for (const { account } of resp.value) {
      // `getParsedTokenAccountsByOwner` returns parsed JSON when the
      // RPC supports it (devnet mainline does). Defensive guard for
      // raw-data fallback.
      const parsed = (account.data as { parsed?: { info?: any } }).parsed;
      const info = parsed?.info;
      if (!info?.mint || !info?.tokenAmount) continue;
      const amountStr: string = info.tokenAmount.amount;
      const decimals: number = info.tokenAmount.decimals;
      let amount: bigint;
      try {
        amount = BigInt(amountStr);
      } catch {
        continue;
      }
      if (amount <= 0n) continue;
      const mint: string = info.mint;
      out.push({
        mint,
        amount,
        decimals,
        programId: programId.toBase58(),
        symbol: KNOWN_DEVNET_SYMBOLS[mint],
      });
    }
  }
  return out;
}

function parseTokenAmount(input: string, decimals: number): bigint | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (!new RegExp(`^\\d+(\\.\\d{0,${decimals}})?$`).test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  try {
    const w = BigInt(whole ?? "0");
    const f = decimals === 0 ? 0n : BigInt(fracPadded || "0");
    const v = w * 10n ** BigInt(decimals) + f;
    if (v <= 0n) return null;
    return v;
  } catch {
    return null;
  }
}

/**
 * Live read of `proposal.approvalCount`. Used by the M-of-N picker
 * after each successful add so the local UI stays in sync with what's
 * actually on chain (concurrent approvers from other browsers can
 * push the count past what this tab knows about).
 */
async function readLiveApprovalCount(
  connection: Connection,
  proposal: PublicKey,
): Promise<number> {
  const info = await connection.getAccountInfo(proposal, "confirmed");
  if (!info || info.data.length === 0) return 0;
  try {
    const acc = decodeProposal(new Uint8Array(info.data));
    return acc.approvalCount;
  } catch {
    return 0;
  }
}

const LAMPORTS_PER_SOL = 1_000_000_000n;

type Stage = "compose" | "review" | "running" | "done";

export default function SweepPageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen" aria-hidden="true" />}>
      <SweepPage />
    </Suspense>
  );
}

function SweepPage() {
  const reduce = useReducedMotion();
  const queryClient = useQueryClient();
  const params = useParams<{ recovery: string }>();
  const { connection } = useConnection();
  const wallet = useWallet();
  const toast = useToast();

  const recoveryStr = useMemo(() => {
    try {
      return decodeURIComponent(params?.recovery ?? "");
    } catch {
      return params?.recovery ?? "";
    }
  }, [params?.recovery]);

  const recoveryPk = useMemo(() => {
    try {
      return new PublicKey(recoveryStr);
    } catch {
      return null;
    }
  }, [recoveryStr]);

  const vaultQuery = useQuery({
    queryKey: ["ikavery-vault", recoveryStr],
    queryFn: () => {
      if (!recoveryPk) throw new Error("Invalid recovery address");
      return fetchVault(connection, recoveryPk);
    },
    enabled: !!recoveryPk,
    staleTime: 30_000,
  });

  const attestation = useMemo(
    () => (recoveryStr ? loadAttestation(recoveryStr) : null),
    [recoveryStr],
  );
  const dwalletPubkey = useMemo<PublicKey | null>(() => {
    if (!attestation) return null;
    try {
      return new PublicKey(attestation.publicKey);
    } catch {
      return null;
    }
  }, [attestation]);

  // The dWallet pays the broadcast tx fee (it's the only signer in
  // the final tx). Show the live balance so the user knows the cap,
  // and let "Max" set the amount to balance minus a 5000-lamport fee
  // reserve. 5000 = current Solana single-signature base fee.
  const FEE_RESERVE_LAMPORTS = 5_000n;
  const dwalletBalanceQ = useQuery({
    queryKey: ["ikavery-dwallet-balance", dwalletPubkey?.toBase58() ?? "none"],
    queryFn: async () => {
      if (!dwalletPubkey) return null;
      return connection.getBalance(dwalletPubkey, "confirmed");
    },
    enabled: !!dwalletPubkey,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });

  const [stage, setStage] = useState<Stage>("compose");
  const [destination, setDestination] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [destinationError, setDestinationError] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [previewMessageBytes, setPreviewMessageBytes] =
    useState<Uint8Array | null>(null);
  const [authMode, setAuthMode] = useState<SweepAuthMode>("wallet");
  /** `null` = SOL; otherwise the SPL mint base58 string (which keys into `holdingsQuery`). */
  const [assetMint, setAssetMint] = useState<string | null>(null);
  /** Cached SPL `SweepTarget` once the user clicks Review. Re-derived for the actual run. */
  const [previewSpl, setPreviewSpl] = useState<{
    mint: string;
    amount: bigint;
    decimals: number;
    symbol?: string;
  } | null>(null);

  const holdingsQuery = useQuery({
    queryKey: ["ikavery-dwallet-holdings", dwalletPubkey?.toBase58() ?? "none"],
    queryFn: async () => {
      if (!dwalletPubkey) return [];
      return fetchDwalletHoldings(connection, dwalletPubkey);
    },
    enabled: !!dwalletPubkey,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  const selectedHolding = useMemo<SplHolding | null>(() => {
    if (!assetMint) return null;
    return holdingsQuery.data?.find((h) => h.mint === assetMint) ?? null;
  }, [assetMint, holdingsQuery.data]);

  const isSpl = assetMint !== null;
  const decimals = isSpl ? (selectedHolding?.decimals ?? 0) : 9;
  const assetSymbol = isSpl
    ? (selectedHolding?.symbol ?? `${assetMint!.slice(0, 4)}…${assetMint!.slice(-4)}`)
    : "SOL";
  const [runStage, setRunStage] = useState<ActionStage | null>(null);
  const [proposeSig, setProposeSig] = useState<string | null>(null);
  const [executeSig, setExecuteSig] = useState<string | null>(null);
  const [broadcastSig, setBroadcastSig] = useState<string | null>(null);

  // M-of-N collection state. When the action layer asks the page to
  // gather more approvals, we render a side-state below the spinner
  // with a Wallet / Passkey picker. Each click hits the chain via
  // `addSweepApproval` and bumps `collectCount`. Once it equals the
  // threshold, `collectResolveRef.current()` lets `runInAppSweep`
  // continue into execute.
  const [collectInfo, setCollectInfo] =
    useState<AdditionalApprovalsRequest | null>(null);
  const [collectCount, setCollectCount] = useState(0);
  const [collectBusy, setCollectBusy] = useState(false);
  const [collectError, setCollectError] = useState<string | null>(null);
  const collectResolveRef = useRef<(() => void) | null>(null);

  // Default authMode based on whether the connected wallet is on the
  // roster. If yes → wallet (one-click). If not (lost-wallet recovery
  // case) → passkey, since the wallet sign credential wouldn't match
  // any member.
  const walletIsMember = useMemo(() => {
    if (!wallet.publicKey || !vaultQuery.data) return false;
    const myBytes = wallet.publicKey.toBytes();
    return vaultQuery.data.account.members.some((slot) => {
      if (slot[0] !== SCHEME_SOLANA_ADDRESS) return false;
      if (slot.length < 33) return false;
      for (let i = 0; i < 32; i++) {
        if (slot[1 + i] !== myBytes[i]) return false;
      }
      return true;
    });
  }, [wallet.publicKey, vaultQuery.data]);

  // Vault has at least one passkey member?
  const vaultHasPasskey = useMemo(() => {
    if (!vaultQuery.data) return false;
    return vaultQuery.data.account.members.some((slot) => slot[0] === 3);
  }, [vaultQuery.data]);

  // Pin authMode once vault loads. Passkey if wallet isn't a member
  // and a passkey exists; otherwise wallet.
  useEffect(() => {
    if (!vaultQuery.data) return;
    if (!walletIsMember && vaultHasPasskey) {
      setAuthMode("passkey");
    } else if (walletIsMember) {
      setAuthMode("wallet");
    }
  }, [vaultQuery.data, walletIsMember, vaultHasPasskey]);

  const baseUnits = useMemo<bigint | null>(() => {
    return parseTokenAmount(amountInput, decimals);
  }, [amountInput, decimals]);

  const destinationPk = useMemo<PublicKey | null>(() => {
    const trimmed = destination.trim();
    if (!trimmed) return null;
    try {
      return new PublicKey(trimmed);
    } catch {
      return null;
    }
  }, [destination]);

  const handleReview = async () => {
    setDestinationError(null);
    setAmountError(null);
    if (!destinationPk) {
      setDestinationError("Enter a valid Solana address.");
      return;
    }
    if (!baseUnits) {
      setAmountError(
        isSpl
          ? `Enter an amount in ${assetSymbol} (e.g. 1.5).`
          : "Enter an amount in SOL (e.g. 0.5).",
      );
      return;
    }
    if (!dwalletPubkey) {
      toast.error("Vault backup needed", {
        details:
          "Import the vault backup or use the browser that created this vault.",
      });
      return;
    }
    if (isSpl && !selectedHolding) {
      toast.error("Token holding not loaded yet");
      return;
    }
    if (isSpl && selectedHolding && baseUnits > selectedHolding.amount) {
      setAmountError(
        `Amount exceeds ${assetSymbol} balance (${formatTokenAmount(selectedHolding.amount, selectedHolding.decimals)}).`,
      );
      return;
    }

    let previewIxs: import("@solana/web3.js").TransactionInstruction[];
    if (!isSpl) {
      previewIxs = [transferSol(dwalletPubkey, destinationPk, baseUnits)];
      setPreviewSpl(null);
    } else {
      // Build a representative ix list for the message-size preview.
      // We deliberately don't probe destination ATA existence here ,
      // that's a network round-trip we'd repeat on Run anyway. Worst
      // case the preview's byte count is one ix off.
      const programId = new PublicKey(selectedHolding!.programId);
      const mintPk = new PublicKey(selectedHolding!.mint);
      const sourceAta = deriveAta(dwalletPubkey, mintPk, programId);
      const destinationAta = deriveAta(destinationPk, mintPk, programId);
      previewIxs = [
        createIdempotentAta({
          payer: dwalletPubkey,
          ata: destinationAta,
          owner: destinationPk,
          mint: new PublicKey(selectedHolding!.mint),
          tokenProgramId: programId,
        }),
        transferSplTokenChecked({
          source: sourceAta,
          mint: new PublicKey(selectedHolding!.mint),
          destination: destinationAta,
          authority: dwalletPubkey,
          amount: baseUnits,
          decimals: selectedHolding!.decimals,
          programId,
        }),
      ];
      setPreviewSpl({
        mint: selectedHolding!.mint,
        amount: baseUnits,
        decimals: selectedHolding!.decimals,
        symbol: selectedHolding!.symbol,
      });
    }
    const { messageBytes } = buildSweepMessage({
      feePayer: dwalletPubkey,
      instructions: previewIxs,
    });
    setPreviewMessageBytes(messageBytes);
    setStage("review");
  };

  const handleRun = async () => {
    if (!destinationPk || !baseUnits || !recoveryPk) return;
    if (!vaultQuery.data) {
      toast.error("Vault not loaded yet");
      return;
    }
    if (!wallet.connected || !wallet.publicKey || !wallet.signTransaction) {
      toast.error("Connect a wallet first");
      return;
    }
    if (!dwalletPubkey) return;
    setRunStage("build");
    setStage("running");
    try {
      let target: SweepTarget;
      if (!isSpl) {
        target = {
          kind: "sol",
          destination: destinationPk,
          lamports: baseUnits,
        };
      } else {
        if (!selectedHolding) throw new Error("Token holding not loaded.");
        target = await prepareSplSweepTarget({
          connection,
          dwallet: dwalletPubkey,
          mint: new PublicKey(selectedHolding.mint),
          destinationOwner: destinationPk,
          amount: baseUnits,
          tokenProgramId: new PublicKey(selectedHolding.programId),
          decimals: selectedHolding.decimals,
        });
      }
      const result = await runInAppSweep({
        authMode,
        connection,
        recovery: recoveryPk,
        recoveryId: vaultQuery.data.account.recoveryId,
        creator: wallet.publicKey,
        target,
        signTransaction: wallet.signTransaction,
        onProgress: (s) => setRunStage(s),
        collectAdditionalApprovals: async (req) => {
          setCollectInfo(req);
          setCollectCount(req.currentCount);
          setCollectError(null);
          // Suspend the action-layer until the page-side picker has
          // gathered enough approvals on chain. The handlers below
          // resolve `collectResolveRef.current` when count >= threshold.
          await new Promise<void>((resolve) => {
            collectResolveRef.current = resolve;
          });
          // Clear the picker state once the action layer continues.
          setCollectInfo(null);
          collectResolveRef.current = null;
        },
      });
      setProposeSig(result.proposeSig);
      setExecuteSig(result.executeSig);
      setBroadcastSig(result.broadcastSig);
      setRunStage(null);
      setStage("done");
      // Invalidate the vault + proposals + balance queries so when the
      // user backs out to the vault detail, the new sweep / updated
      // balance show up without waiting for the next 30s refetch.
      void queryClient.invalidateQueries({
        queryKey: ["ikavery-vault", recoveryStr],
      });
      void queryClient.invalidateQueries({
        queryKey: ["ikavery-proposals", recoveryStr],
      });
      void queryClient.invalidateQueries({
        queryKey: ["ikavery-dwallet-balance"],
      });
    } catch (e) {
      console.error("[secure/sweep]", e);
      const copy = secureActionErrorCopy(e, "Sweep failed");
      toast.error(copy.title, { details: copy.details });
      setRunStage(null);
      setCollectInfo(null);
      collectResolveRef.current = null;
      setStage("review");
    }
  };

  /// Handler the additional-approvals UI calls when the user picks a
  /// credential to add the next vote. Single-flight: ignored if a
  /// previous click is still in flight.
  const handleAddApproval = async (mode: SweepAuthMode) => {
    if (collectBusy) return;
    if (!collectInfo || !recoveryPk) return;
    if (!wallet.publicKey || !wallet.signTransaction) {
      setCollectError("Connect a wallet first.");
      return;
    }
    setCollectBusy(true);
    setCollectError(null);
    try {
      await addSweepApproval({
        connection,
        recovery: recoveryPk,
        proposal: collectInfo.proposal,
        payer: wallet.publicKey,
        authMode: mode,
        walletPubkey: mode === "wallet" ? wallet.publicKey : undefined,
        signTransaction: wallet.signTransaction,
      });
      // Re-read the on-chain count instead of trusting `collectCount + 1`.
      // If a different approver landed an approval concurrently (other
      // browser, other device), the chain may already be at threshold ,
      // we want to resolve and continue to execute, not wait for more
      // local clicks. fetchVault doesn't help here (it's the proposal,
      // not the recovery), so go through the proposal codec directly.
      const liveCount = await readLiveApprovalCount(
        connection,
        collectInfo.proposal,
      );
      setCollectCount(liveCount);
      if (liveCount >= collectInfo.threshold) {
        const resolve = collectResolveRef.current;
        if (resolve) resolve();
      }
    } catch (e) {
      console.error("[secure/sweep] addApproval", e);
      setCollectError(
        secureActionErrorCopy(e, "Couldn't add approval").details,
      );
    } finally {
      setCollectBusy(false);
    }
  };

  if (!recoveryPk) {
    return (
      <div className="px-gutter">
        <p className="text-sm text-text-soft">Invalid vault address.</p>
      </div>
    );
  }
  const blockedByDisconnect = !wallet.connected;
  const fadeIn = (delay = 0) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 10 },
          animate: { opacity: 1, y: 0 },
          transition: {
            duration: 0.4,
            delay,
            ease: [0.22, 1, 0.36, 1] as const,
          },
        };

  return (
    <motion.div {...fadeIn(0)} className="flex flex-col gap-8">
      <div className="px-gutter">
        <Link
          href={`/app/secure/${encodeURIComponent(recoveryStr)}`}
          className="inline-flex items-center gap-1.5 text-xs text-text-soft hover:text-text-strong"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden="true" />
          Back to vault
        </Link>
      </div>

      {blockedByDisconnect && (
        <PageEyebrow label="Sign in to continue" align="center">
          <h1 className="font-display text-display-sm leading-[1.05] text-text-strong">
            Connect a wallet first
          </h1>
          <p className="mx-auto mt-2 max-w-md text-base text-text-soft">
            Sweep is authorised by the vault&rsquo;s roster. Sign in to
            compose one.
          </p>
          <Link
            href={`/connect?next=/app/secure/${encodeURIComponent(recoveryStr)}/sweep`}
            className="mt-5 inline-flex"
          >
            <Button size="lg">
              Sign in
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </Link>
        </PageEyebrow>
      )}

      {!blockedByDisconnect && vaultQuery.isError && (
        <div className="mx-auto max-w-md rounded-card border border-warning/40 bg-warning/[0.06] p-4 text-sm text-text-soft">
          <p className="font-medium text-text-strong">
            Couldn&rsquo;t load this vault.
          </p>
          <p className="mt-1">
            {vaultQuery.error instanceof Error
              ? vaultQuery.error.message
              : String(vaultQuery.error)}
          </p>
          <button
            type="button"
            onClick={() => vaultQuery.refetch()}
            className="mt-3 inline-flex min-h-tap items-center gap-1.5 rounded-full border border-border-soft bg-canvas px-3 py-1.5 text-[11px] font-medium text-text-soft hover:border-accent hover:text-accent"
          >
            Retry
          </button>
        </div>
      )}

      {!blockedByDisconnect &&
        !vaultQuery.isError &&
        stage === "compose" && (
        <ComposeStage
          destination={destination}
          setDestination={setDestination}
          destinationError={destinationError}
          amountInput={amountInput}
          setAmountInput={setAmountInput}
          amountError={amountError}
          dwalletPubkey={dwalletPubkey?.toBase58() ?? null}
          recoveryShort={`${recoveryStr.slice(0, 4)}…${recoveryStr.slice(-4)}`}
          loading={vaultQuery.isLoading}
          balanceLamports={
            typeof dwalletBalanceQ.data === "number"
              ? BigInt(dwalletBalanceQ.data)
              : null
          }
          assetMint={assetMint}
          setAssetMint={setAssetMint}
          assetSymbol={assetSymbol}
          decimals={decimals}
          holdings={holdingsQuery.data ?? null}
          holdingsLoading={holdingsQuery.isLoading}
          selectedHolding={selectedHolding}
          onMax={() => {
            if (isSpl) {
              if (!selectedHolding) return;
              setAmountInput(
                formatTokenAmount(selectedHolding.amount, selectedHolding.decimals),
              );
              return;
            }
            if (typeof dwalletBalanceQ.data !== "number") return;
            const balance = BigInt(dwalletBalanceQ.data);
            if (balance <= FEE_RESERVE_LAMPORTS) {
              setAmountInput("0");
              return;
            }
            const maxLamports = balance - FEE_RESERVE_LAMPORTS;
            setAmountInput(formatLamportsToSol(maxLamports));
          }}
          onContinue={handleReview}
          reduce={!!reduce}
        />
      )}

      {!blockedByDisconnect && stage === "review" && (
        <ReviewStage
          destination={destinationPk?.toBase58() ?? ""}
          amountDisplay={`${amountInput} ${assetSymbol}`}
          dwalletPubkey={dwalletPubkey?.toBase58() ?? ""}
          messageBytesLen={previewMessageBytes?.length ?? 0}
          isSpl={isSpl}
          willCreateAta={
            previewSpl !== null &&
            previewMessageBytes !== null
            // The compose-stage preview always includes the AtaCreate ix
            // for size estimation; the actual run only emits it when the
            // destination ATA doesn't exist. We surface this disclosure
            // so the user knows the run might cost an extra ~2 KB of
            // rent + ~5 KB of compute.
          }
          authMode={authMode}
          setAuthMode={setAuthMode}
          walletIsMember={walletIsMember}
          vaultHasPasskey={vaultHasPasskey}
          onBack={() => setStage("compose")}
          onContinue={handleRun}
          reduce={!!reduce}
        />
      )}

      {!blockedByDisconnect && stage === "running" && (
        <RunningStage
          subStage={runStage}
          authMode={authMode}
          reduce={!!reduce}
          collect={
            collectInfo
              ? {
                  count: collectCount,
                  threshold: collectInfo.threshold,
                  busy: collectBusy,
                  error: collectError,
                  walletEnabled: walletIsMember,
                  onPick: handleAddApproval,
                }
              : null
          }
        />
      )}

      {stage === "done" && (
        <DoneStage
          amountDisplay={`${amountInput} ${assetSymbol}`}
          destination={destinationPk?.toBase58() ?? ""}
          proposeSig={proposeSig}
          executeSig={executeSig}
          broadcastSig={broadcastSig}
          recoveryStr={recoveryStr}
          reduce={!!reduce}
        />
      )}
    </motion.div>
  );
}
