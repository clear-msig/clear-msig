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
  Check,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { useConnection, useWallet } from "@/lib/wallet";
import { Button } from "@/components/retail/Button";
import { PageEyebrow } from "@/components/retail/PageEyebrow";
import { UsdHint } from "@/components/retail/UsdHint";
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

interface SplHolding {
  mint: string;
  amount: bigint;
  decimals: number;
  programId: string;
  /** Optional symbol derived from a small static list (USDC, USDT…). */
  symbol?: string;
}

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

function formatTokenAmount(amount: bigint, decimals: number): string {
  if (decimals === 0) return amount.toString();
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const frac = amount % base;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
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

interface RunStageInfo {
  id: ActionStage;
  label: string;
  detail: string;
}

const WALLET_RUN_STAGES: RunStageInfo[] = [
  {
    id: "build",
    label: "Preparing transfer",
    detail: "Checking the amount and destination.",
  },
  {
    id: "propose-approve-sign",
    label: "Approve transfer",
    detail: "Confirm in your wallet.",
  },
  {
    id: "propose-approve-confirm",
    label: "Saving approval",
    detail: "Recording your approval.",
  },
  {
    id: "execute-sign",
    label: "Approve release",
    detail: "Confirm the final release.",
  },
  {
    id: "execute-confirm",
    label: "Releasing funds",
    detail: "Confirming the release.",
  },
  {
    id: "presign-sign",
    label: "Securing transfer",
    detail: "Completing vault approval.",
  },
  {
    id: "broadcast",
    label: "Sending transfer",
    detail: "Sending funds to the destination.",
  },
  {
    id: "broadcast-confirm",
    label: "Waiting for confirmation",
    detail: "Confirming the funds moved.",
  },
];

const PASSKEY_RUN_STAGES: RunStageInfo[] = [
  {
    id: "build",
    label: "Building sweep",
    detail: "Encoding the SOL transfer + structural intent digest.",
  },
  {
    id: "propose-passkey",
    label: "Tap your passkey · propose",
    detail: "Authorising the proposal with a per-op WebAuthn assertion.",
  },
  {
    id: "propose-approve-sign",
    label: "Sign propose tx",
    detail: "Confirm in your wallet. Pays fees, doesn't authorise.",
  },
  {
    id: "propose-approve-confirm",
    label: "Submitting propose",
    detail: "Recording the proposal on Solana.",
  },
  {
    id: "approve-passkey",
    label: "Tap your passkey · approve",
    detail: "Same passkey signs the approval challenge.",
  },
  {
    id: "approve-sign",
    label: "Sign approve tx",
    detail: "Confirm in your wallet. Pays fees again.",
  },
  {
    id: "approve-confirm",
    label: "Submitting approve",
    detail: "Threshold reached on chain.",
  },
  {
    id: "execute-sign",
    label: "Approve release",
    detail: "Confirm the final release.",
  },
  {
    id: "execute-confirm",
    label: "Releasing funds",
    detail: "Confirming the release.",
  },
  {
    id: "presign-sign",
    label: "Securing transfer",
    detail: "Completing vault approval.",
  },
  {
    id: "broadcast",
    label: "Sending transfer",
    detail: "Sending funds to the destination.",
  },
  {
    id: "broadcast-confirm",
    label: "Waiting for confirmation",
    detail: "Confirming the funds moved.",
  },
];

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

interface ComposeStageProps {
  destination: string;
  setDestination: (v: string) => void;
  destinationError: string | null;
  amountInput: string;
  setAmountInput: (v: string) => void;
  amountError: string | null;
  dwalletPubkey: string | null;
  recoveryShort: string;
  loading: boolean;
  /** Live dWallet SOL balance in lamports. Used for "Max" + helper text. */
  balanceLamports: bigint | null;
  /** `null` = SOL; otherwise the picked SPL mint base58. */
  assetMint: string | null;
  setAssetMint: (m: string | null) => void;
  assetSymbol: string;
  decimals: number;
  holdings: SplHolding[] | null;
  holdingsLoading: boolean;
  selectedHolding: SplHolding | null;
  onMax: () => void;
  onContinue: () => void;
  reduce: boolean;
}

function ComposeStage(props: ComposeStageProps) {
  const motionProps = props.reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  const isSpl = props.assetMint !== null;
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-6"
    >
      <PageEyebrow label="// 03 · sweep" align="center">
        <h1 className="font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          Sweep funds out
        </h1>
        <p className="mx-auto mt-2 max-w-md text-base text-text-soft">
          Move {props.assetSymbol} from this vault to a destination address.
        </p>
      </PageEyebrow>

      <section className="mx-auto w-full max-w-md flex flex-col gap-4 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        {/* Asset picker. SOL is always available; SPL holdings appear
            when the dWallet owns any token accounts. */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="sweep-asset"
            className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-soft"
          >
            Asset
          </label>
          <select
            id="sweep-asset"
            value={props.assetMint ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              props.setAssetMint(v ? v : null);
              props.setAmountInput("");
            }}
            className="rounded-soft border border-border-soft bg-canvas px-3 py-2 text-sm text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">
              SOL
              {props.balanceLamports != null
                ? ` · ${formatLamportsToSol(props.balanceLamports)} available`
                : ""}
            </option>
            {(props.holdings ?? []).map((h) => {
              const display = h.symbol ?? `${h.mint.slice(0, 4)}…${h.mint.slice(-4)}`;
              return (
                <option key={h.mint} value={h.mint}>
                  {display} · {formatTokenAmount(h.amount, h.decimals)} available
                </option>
              );
            })}
          </select>
          {props.holdingsLoading && (
            <p className="text-[10px] text-text-soft">Reading token balances…</p>
          )}
          {!props.holdingsLoading &&
            (props.holdings == null || props.holdings.length === 0) && (
              <p className="text-[10px] text-text-soft">
                No tokens detected yet. Only SOL.
              </p>
            )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="sweep-destination"
            className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-soft"
          >
            Destination address
          </label>
          <input
            id="sweep-destination"
            type="text"
            value={props.destination}
            onChange={(e) => props.setDestination(e.target.value)}
            placeholder="Solana address"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            className="rounded-soft border border-border-soft bg-canvas px-3 py-2 font-mono text-sm text-text-strong placeholder:text-text-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          {props.destinationError && (
            <p className="text-[11px] text-warning">{props.destinationError}</p>
          )}
          {isSpl && (
            <p className="text-[10px] text-text-soft">
              Sends to the recipient&rsquo;s wallet. We derive their{" "}
              {props.assetSymbol} ATA and create it on the fly if needed.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-end justify-between gap-2">
            <label
              htmlFor="sweep-amount"
              className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-soft"
            >
              Amount ({props.assetSymbol})
            </label>
            {!isSpl && props.balanceLamports != null && (
              <span className="font-numerals text-[10px] tabular-nums text-text-soft">
                Balance: {formatLamportsToSol(props.balanceLamports)} SOL
                <UsdHint
                  amount={props.balanceLamports}
                  smallestPerWhole={1_000_000_000n}
                  ticker="SOL"
                />
              </span>
            )}
            {isSpl && props.selectedHolding && (
              <span className="font-numerals text-[10px] tabular-nums text-text-soft">
                Balance:{" "}
                {formatTokenAmount(
                  props.selectedHolding.amount,
                  props.selectedHolding.decimals,
                )}{" "}
                {props.assetSymbol}
                <UsdHint
                  amount={props.selectedHolding.amount}
                  smallestPerWhole={
                    10n ** BigInt(props.selectedHolding.decimals)
                  }
                  ticker={props.assetSymbol}
                />
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              id="sweep-amount"
              type="text"
              inputMode="decimal"
              value={props.amountInput}
              onChange={(e) => props.setAmountInput(e.target.value)}
              placeholder="0.0"
              spellCheck={false}
              autoComplete="off"
              className="flex-1 rounded-soft border border-border-soft bg-canvas px-3 py-2 font-numerals text-base tabular-nums text-text-strong placeholder:text-text-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <button
              type="button"
              onClick={props.onMax}
              disabled={
                isSpl ? !props.selectedHolding : props.balanceLamports == null
              }
              className={
                "shrink-0 rounded-soft border border-border-soft bg-canvas px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-text-soft " +
                "transition-[border-color,color] duration-base ease-out-soft hover:border-accent hover:text-accent " +
                "disabled:cursor-not-allowed disabled:opacity-50 " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              }
              title={
                isSpl
                  ? "Use full token balance"
                  : "Use max (balance minus fee reserve)"
              }
            >
              Max
            </button>
          </div>
          {props.amountError && (
            <p className="text-[11px] text-warning">{props.amountError}</p>
          )}
        </div>

        <div className="rounded-soft border border-border-soft bg-canvas p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-soft">
            From
          </p>
          <p className="mt-1 break-all font-mono text-[11px] text-text-strong">
            {props.dwalletPubkey ?? "Vault backup needed"}
          </p>
        </div>
      </section>

      <div className="mx-auto flex flex-col items-center gap-2">
        <Button size="lg" onClick={props.onContinue} disabled={props.loading}>
          Review
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </motion.section>
  );
}

interface ReviewStageProps {
  destination: string;
  amountDisplay: string;
  dwalletPubkey: string;
  messageBytesLen: number;
  isSpl: boolean;
  willCreateAta: boolean;
  authMode: SweepAuthMode;
  setAuthMode: (m: SweepAuthMode) => void;
  walletIsMember: boolean;
  vaultHasPasskey: boolean;
  onBack: () => void;
  onContinue: () => void;
  reduce: boolean;
}

function ReviewStage(props: ReviewStageProps) {
  const motionProps = props.reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  const showPicker = props.walletIsMember && props.vaultHasPasskey;
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-6"
    >
      <PageEyebrow label="// 03 · sweep" align="center">
        <h1 className="font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          Confirm the sweep
        </h1>
        <p className="mx-auto mt-2 max-w-md text-base text-text-soft">
          The on-chain instruction is built. Review before you continue.
        </p>
      </PageEyebrow>

      <section className="mx-auto w-full max-w-md rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        <dl className="flex flex-col gap-3">
          <Row label="Amount" value={props.amountDisplay} mono={false} />
          <Row label="From" value={shortPub(props.dwalletPubkey)} title={props.dwalletPubkey} />
          <Row label="To" value={shortPub(props.destination)} title={props.destination} />
          <Row
            label="Message bytes"
            value={`${props.messageBytesLen} B`}
            mono={false}
          />
          {props.isSpl && (
            <Row
              label="Recipient ATA"
              value={
                props.willCreateAta
                  ? "May be created on the fly"
                  : "Derived from recipient + mint"
              }
              mono={false}
            />
          )}
        </dl>
      </section>

      {/* Auth picker. Only shown when both options are viable. If the
          connected wallet isn't on the roster (lost-wallet recovery),
          passkey is the only option and the picker hides. If the vault
          has no passkey members, wallet is the only option. */}
      {showPicker && (
        <section className="mx-auto w-full max-w-md flex flex-col gap-2 rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-soft">
            Authorise as
          </p>
          <div className="grid grid-cols-2 gap-2">
            <AuthOption
              active={props.authMode === "wallet"}
              onClick={() => props.setAuthMode("wallet")}
              label="Wallet"
              detail="One-tap. Bundles propose + approve."
            />
            <AuthOption
              active={props.authMode === "passkey"}
              onClick={() => props.setAuthMode("passkey")}
              label="Passkey"
              detail="Two passkey taps. Lost-wallet recovery."
            />
          </div>
        </section>
      )}
      {!showPicker && props.authMode === "passkey" && (
        <p className="mx-auto max-w-md text-center text-[11px] text-text-soft">
          Connected wallet isn&rsquo;t on this vault&rsquo;s roster. Sweeping
          via enrolled passkey.
        </p>
      )}

      <div className="mx-auto flex items-center gap-2">
        <Button variant="ghost" onClick={props.onBack}>
          Back
        </Button>
        <Button size="lg" onClick={props.onContinue}>
          Continue
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </motion.section>
  );
}

function AuthOption({
  active,
  onClick,
  label,
  detail,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex flex-col items-start gap-1 rounded-soft border bg-canvas px-3 py-3 text-left " +
        "transition-[border-color,background-color] duration-base ease-out-soft " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
        (active
          ? "border-accent bg-accent/[0.05]"
          : "border-border-soft hover:border-accent/40")
      }
    >
      <span
        className={
          "text-sm font-semibold " +
          (active ? "text-accent" : "text-text-strong")
        }
      >
        {label}
      </span>
      <span className="text-[11px] text-text-soft">{detail}</span>
    </button>
  );
}

function Row({
  label,
  value,
  title,
  mono = true,
}: {
  label: string;
  value: string;
  title?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-soft">
        {label}
      </dt>
      <dd
        title={title}
        className={
          "min-w-0 flex-1 truncate text-right text-sm text-text-strong " +
          (mono ? "font-mono" : "font-numerals tabular-nums")
        }
      >
        {value}
      </dd>
    </div>
  );
}

interface CollectStateProps {
  count: number;
  threshold: number;
  busy: boolean;
  error: string | null;
  /** Disable the Wallet button when the connected wallet isn't on the roster.
   *  Avoids users tapping it and getting a delayed "not a member" error. */
  walletEnabled: boolean;
  onPick: (mode: SweepAuthMode) => void;
}

interface RunningStageProps {
  subStage: ActionStage | null;
  authMode: SweepAuthMode;
  reduce: boolean;
  collect: CollectStateProps | null;
}

function RunningStage({
  subStage,
  authMode,
  reduce,
  collect,
}: RunningStageProps) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  const RUN_STAGES =
    authMode === "passkey" ? PASSKEY_RUN_STAGES : WALLET_RUN_STAGES;
  const activeIdx = subStage ? RUN_STAGES.findIndex((s) => s.id === subStage) : 0;
  const active = activeIdx >= 0 ? RUN_STAGES[activeIdx] : RUN_STAGES[0]!;
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.3 }}
      className="flex flex-col items-center gap-6 px-gutter py-16"
    >
      {/* When the action layer is paused waiting for additional
          approvals, show a credential picker instead of the spinner.
          The page has the live count + threshold; each click on a
          mode kicks off `addSweepApproval` and bumps the count. */}
      {collect ? (
        <>
          <div className="flex flex-col items-center gap-1 text-center">
            <p className="font-display text-xl font-semibold text-text-strong">
              {collect.count} of {collect.threshold} approvals
            </p>
            <p className="max-w-sm text-sm text-text-soft">
              The proposer&rsquo;s vote is in. Add the rest of the quorum
              by tapping a different credential for each.
            </p>
          </div>
          <div className="flex w-full max-w-md flex-col gap-2">
            <button
              type="button"
              onClick={() => collect.onPick("wallet")}
              disabled={collect.busy || !collect.walletEnabled}
              title={
                collect.walletEnabled
                  ? undefined
                  : "Connected wallet isn't on this vault's roster"
              }
              className={
                "flex w-full min-h-tap items-center justify-center gap-2 rounded-card border border-border-soft bg-surface-raised px-4 py-3 text-sm font-medium text-text-strong shadow-card-rest " +
                "transition-[border-color,transform] duration-base ease-out-soft " +
                "hover:-translate-y-0.5 hover:border-accent/40 " +
                "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:border-border-soft " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              }
            >
              {collect.busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              Approve as Wallet
              {!collect.walletEnabled && (
                <span className="font-mono text-[10px] text-text-soft">
                  (not on roster)
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => collect.onPick("passkey")}
              disabled={collect.busy}
              className={
                "flex w-full min-h-tap items-center justify-center gap-2 rounded-card border border-border-soft bg-surface-raised px-4 py-3 text-sm font-medium text-text-strong shadow-card-rest " +
                "transition-[border-color,transform] duration-base ease-out-soft " +
                "hover:-translate-y-0.5 hover:border-accent/40 " +
                "disabled:cursor-not-allowed disabled:opacity-50 " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              }
            >
              {collect.busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              Approve as Passkey
            </button>
          </div>
          {collect.error && (
            <p className="max-w-md text-center text-[11px] text-warning">
              {collect.error}
            </p>
          )}
        </>
      ) : (
        <>
          <Loader2
            className="h-10 w-10 animate-spin text-accent"
            strokeWidth={1.5}
            aria-hidden="true"
          />
          <div className="flex flex-col items-center gap-1 text-center">
            <p className="font-display text-xl font-semibold text-text-strong">
              {active?.label ?? "Sweeping…"}
            </p>
            <p className="max-w-sm text-sm text-text-soft">
              {active?.detail ?? "Running through the sweep stages."}
            </p>
          </div>
          <ol
            className="flex items-center gap-1.5"
            aria-label="sweep progress"
          >
            {RUN_STAGES.map((s, i) => {
              const completed = activeIdx > i;
              const current = activeIdx === i;
              return (
                <li
                  key={s.id}
                  aria-label={s.label}
                  className={
                    "h-1.5 w-6 rounded-full " +
                    (completed
                      ? "bg-accent"
                      : current
                        ? "bg-accent/60"
                        : "bg-border-soft")
                  }
                />
              );
            })}
          </ol>
        </>
      )}
    </motion.section>
  );
}

interface DoneStageProps {
  amountDisplay: string;
  destination: string;
  proposeSig: string | null;
  executeSig: string | null;
  broadcastSig: string | null;
  recoveryStr: string;
  reduce: boolean;
}

function DoneStage(props: DoneStageProps) {
  const motionProps = props.reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  const explorer = (sig: string) =>
    `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-6"
    >
      <PageEyebrow label="// 03 · sweep" align="center">
        <span className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Check className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
        </span>
        <h1 className="mt-3 font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          Funds moved
        </h1>
        <p className="mx-auto mt-2 max-w-md text-base text-text-soft">
          {props.amountDisplay} is on its way to{" "}
          <span className="font-mono text-text-strong">
            {shortPub(props.destination)}
          </span>
          . Three Solana txs took it across the line.
        </p>
      </PageEyebrow>

      <ul className="mx-auto flex w-full max-w-md flex-col gap-2">
        <ExplorerRow
          label="Propose + approve"
          sig={props.proposeSig}
          href={props.proposeSig ? explorer(props.proposeSig) : null}
        />
        <ExplorerRow
          label="Execute (MessageApproval)"
          sig={props.executeSig}
          href={props.executeSig ? explorer(props.executeSig) : null}
        />
        <ExplorerRow
          label="Sweep broadcast"
          sig={props.broadcastSig}
          href={props.broadcastSig ? explorer(props.broadcastSig) : null}
          highlight
        />
      </ul>

      <div className="mx-auto flex flex-col items-center gap-2">
        <Link
          href={`/app/secure/${encodeURIComponent(props.recoveryStr)}`}
          className="inline-flex"
        >
          <Button size="lg">
            Back to vault
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </Link>
      </div>
    </motion.section>
  );
}

function ExplorerRow({
  label,
  sig,
  href,
  highlight,
}: {
  label: string;
  sig: string | null;
  href: string | null;
  highlight?: boolean;
}) {
  if (!sig || !href) return null;
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={
          "group flex items-center gap-3 rounded-card border bg-surface-raised p-3 shadow-card-rest " +
          "transition-[border-color,transform] duration-base ease-out-soft " +
          "hover:-translate-y-0.5 " +
          (highlight
            ? "border-accent/60 hover:border-accent"
            : "border-border-soft hover:border-accent/40")
        }
      >
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-soft">
            {label}
          </span>
          <span className="truncate font-mono text-[11px] text-text-strong">
            {sig}
          </span>
        </div>
        <ExternalLink
          className="h-4 w-4 shrink-0 text-text-soft transition-colors group-hover:text-accent"
          aria-hidden="true"
        />
      </a>
    </li>
  );
}

function shortPub(p: string): string {
  if (p.length < 10) return p;
  return `${p.slice(0, 4)}…${p.slice(-4)}`;
}

/**
 * Format `lamports` as a SOL string, trimming trailing zeros down to
 * 4 decimal places minimum. Used for the balance helper text and the
 * "Max" button population. Both display contexts, never parsed back.
 */
function formatLamportsToSol(lamports: bigint): string {
  const whole = lamports / LAMPORTS_PER_SOL;
  const frac = lamports % LAMPORTS_PER_SOL;
  const fracStr = frac.toString().padStart(9, "0").replace(/0+$/, "");
  if (fracStr.length === 0) return whole.toString();
  // 4 decimals min so amounts like 0.05 don't render as "0.05" with a
  // truncated fractional tail that surprises a "Max"-then-edit user.
  const padded = fracStr.length >= 4 ? fracStr : fracStr.padEnd(4, "0");
  return `${whole}.${padded}`;
}
