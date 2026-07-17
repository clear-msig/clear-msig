"use client";

// /app/secure/[recovery]/threshold. Bump the vault's approval threshold.
//
// Two auth modes:
//   - Wallet (default when connected wallet is a roster member): one
//     stage tx, one propose tx, one approval tx, then an execute tx if
//     the new quorum needs more votes.
//   - Passkey (default when wallet ISN'T a member, but the vault has
//     a passkey): two passkey taps + one or more wallet popups,
//     splitting the work into propose, approve, collect, then execute
//     so each signed tx carries its own secp256r1 precompile + assertion.
//
// Pre-conditions enforced upfront so the user never gets a surprise
// at sign time:
//   - vault has ≥ 2 members (no quorum to change otherwise)
//   - new threshold differs from current
//   - in wallet mode: connected wallet is on the roster

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { useConnection, useWallet } from "@/lib/wallet";
import { Button } from "@/components/retail/Button";
import { BackToWallets } from "@/components/retail/BackToWallets";
import {
  BlockedNote,
  DoneStage,
  IntroStage,
  RunningStage,
} from "./RecoveryThresholdStages";
import { useToast } from "@/components/ui/Toast";
import { fetchVault } from "@/lib/ikavery/clearmsig-actions";
import {
  addRosterChangeApproval,
  bumpThresholdSimple,
  readRosterChangeApprovalCount,
  type AdditionalApprovalsRequest,
  type BumpAuthMode,
  type BumpThresholdStage,
} from "@/lib/ikavery/clearmsig-roster";
import {
  detectWebauthnAvailability,
  type WebauthnAvailability,
} from "@/lib/ikavery/webauthn";
import { SCHEME_SOLANA_ADDRESS, SCHEME_WEBAUTHN } from "@/lib/ikavery/constants";
import { secureActionErrorCopy } from "@/lib/ikavery/errors";

type Stage = "intro" | "running" | "done";

export default function ThresholdPageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen" aria-hidden="true" />}>
      <ThresholdPage />
    </Suspense>
  );
}

function ThresholdPage() {
  const reduce = useReducedMotion();
  const router = useRouter();
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

  const memberCount = vaultQuery.data?.account.members.length ?? 0;
  const currentThreshold = vaultQuery.data?.account.threshold ?? 1;
  const minNew = 2;
  const maxNew = memberCount;
  // Default to a balanced majority. For 2 members → 2-of-2. For 3 → 2-of-3.
  // For 5 → 3-of-5. Pattern: ceil(N/2) + 1 for odd, N/2 + 1 for even
  // (collapses to "majority + 1". The one Ikavery's docs call out as
  // the recommended secure default).
  const defaultNew = Math.max(2, Math.floor(memberCount / 2) + 1);
  const [newThreshold, setNewThreshold] = useState(defaultNew);

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

  const vaultHasPasskey = useMemo(() => {
    if (!vaultQuery.data) return false;
    return vaultQuery.data.account.members.some(
      (slot) => slot[0] === SCHEME_WEBAUTHN,
    );
  }, [vaultQuery.data]);

  const [authMode, setAuthMode] = useState<BumpAuthMode>("wallet");

  // Pin authMode once vault loads. Passkey if wallet isn't a member,
  // wallet otherwise. The user can flip after; this just picks a sane
  // default based on what's actually available on chain.
  useEffect(() => {
    if (!vaultQuery.data) return;
    if (!walletIsMember && vaultHasPasskey) {
      setAuthMode("passkey");
    } else if (walletIsMember) {
      setAuthMode("wallet");
    }
  }, [vaultQuery.data, walletIsMember, vaultHasPasskey]);

  // Pre-flight WebAuthn capability check so the user gets a clear
  // message at page load instead of a hung passkey prompt.
  const [webauthnState, setWebauthnState] =
    useState<WebauthnAvailability | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setWebauthnState(
      detectWebauthnAvailability({
        isSecureContext: window.isSecureContext,
        hasCredentialsGet:
          typeof navigator !== "undefined" &&
          !!navigator.credentials &&
          typeof navigator.credentials.get === "function",
      }),
    );
  }, []);

  const [stage, setStage] = useState<Stage>("intro");
  const [runStage, setRunStage] = useState<BumpThresholdStage | null>(null);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [collectInfo, setCollectInfo] =
    useState<AdditionalApprovalsRequest | null>(null);
  const [collectCount, setCollectCount] = useState(0);
  const [collectBusy, setCollectBusy] = useState(false);
  const [collectError, setCollectError] = useState<string | null>(null);
  const collectResolveRef = useRef<(() => void) | null>(null);

  const handleRun = async () => {
    if (!recoveryPk || !vaultQuery.data) return;
    if (!wallet.connected || !wallet.publicKey || !wallet.signTransaction) {
      toast.error("Connect a wallet first");
      return;
    }
    if (authMode === "passkey" && webauthnState?.ok === false) {
      toast.error("Passkey unavailable", {
        details:
          webauthnState.reason === "insecure"
            ? "Reload over HTTPS and try again."
            : "This browser doesn't expose WebAuthn. Try Chrome / Safari / Edge in a normal tab.",
      });
      return;
    }
    setRunStage("stage-sign");
    setStage("running");
    setCollectInfo(null);
    setCollectCount(0);
    setCollectBusy(false);
    setCollectError(null);
    collectResolveRef.current = null;
    try {
      const result = await bumpThresholdSimple({
        connection,
        recovery: recoveryPk,
        recoveryId: vaultQuery.data.account.recoveryId,
        creator: wallet.publicKey,
        newThreshold,
        authMode,
        signTransaction: wallet.signTransaction,
        onProgress: (s) => setRunStage(s),
        collectAdditionalApprovals: async (req) => {
          setCollectInfo(req);
          setCollectCount(req.currentCount);
          setCollectError(null);
          await new Promise<void>((resolve) => {
            collectResolveRef.current = resolve;
          });
          setCollectInfo(null);
          collectResolveRef.current = null;
        },
      });
      setTxSig(result.txSignature);
      setRunStage(null);
      setStage("done");
      // Refresh the vault detail so the new threshold + roster_change_count
      // show up when the user navigates back.
      void queryClient.invalidateQueries({
        queryKey: ["ikavery-vault", recoveryStr],
      });
    } catch (e) {
      console.error("[secure/threshold]", e);
      const copy = secureActionErrorCopy(e, "Couldn't change protection");
      toast.error(copy.title, { details: copy.details });
      setRunStage(null);
      setCollectInfo(null);
      setCollectBusy(false);
      setCollectError(null);
      collectResolveRef.current = null;
      setStage("intro");
    }
  };

  const handleAddApproval = async (mode: BumpAuthMode) => {
    if (collectBusy) return;
    if (!collectInfo || !recoveryPk) return;
    if (!wallet.publicKey || !wallet.signTransaction) {
      setCollectError("Connect a wallet first.");
      return;
    }
    if (mode === "wallet" && authMode === "wallet") {
      setCollectError("The connected wallet already cast the proposer vote.");
      return;
    }
    setCollectBusy(true);
    setCollectError(null);
    try {
      await addRosterChangeApproval({
        connection,
        recovery: recoveryPk,
        rosterChange: collectInfo.proposal,
        payer: wallet.publicKey,
        authMode: mode,
        walletPubkey: mode === "wallet" ? wallet.publicKey : undefined,
        rpId:
          typeof window !== "undefined" ? window.location.hostname : undefined,
        signTransaction: wallet.signTransaction,
      });
      const liveCount = await readRosterChangeApprovalCount(
        connection,
        collectInfo.proposal,
      );
      setCollectCount(liveCount);
      if (liveCount >= collectInfo.threshold) {
        const resolve = collectResolveRef.current;
        if (resolve) {
          collectResolveRef.current = null;
          resolve();
        }
      }
    } catch (e) {
      console.error("[secure/threshold] addApproval", e);
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

  const blockedByDisconnect = !wallet.connected;
  const blockedByMembers = !!vaultQuery.data && memberCount < 2;
  const blockedByThreshold =
    !!vaultQuery.data &&
    walletIsMember &&
    currentThreshold !== 1 &&
    !vaultHasPasskey;
  // Wallet not a member AND vault has no passkey to fall back to →
  // there is genuinely nothing the user can do here.
  const blockedByNotMember =
    !!vaultQuery.data &&
    wallet.connected &&
    !walletIsMember &&
    !vaultHasPasskey;

  return (
    <motion.div {...fadeIn(0)} className="flex flex-col gap-8">
      <div className="px-gutter md:hidden">
        <BackToWallets label="Wallets" />
      </div>

      {stage !== "done" && (
        <div className="px-gutter">
          <Link
            href={`/app/secure/${encodeURIComponent(recoveryStr)}`}
            className="inline-flex items-center gap-1.5 text-xs text-text-soft hover:text-text-strong"
          >
            <ArrowLeft className="h-3 w-3" aria-hidden="true" />
            Back to vault
          </Link>
        </div>
      )}

      {blockedByDisconnect && (
        <BlockedNote
          eyebrow="Sign in to continue"
          title="Connect a wallet first"
          body="A trusted member needs to approve this protection change."
          cta={{
            href: `/connect?next=/app/secure/${encodeURIComponent(recoveryStr)}/threshold`,
            label: "Sign in",
          }}
        />
      )}

      {!blockedByDisconnect && vaultQuery.isLoading && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-text-soft">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Reading vault state…
        </div>
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
        vaultQuery.data &&
        blockedByMembers && (
          <BlockedNote
            eyebrow="Solo vault"
            title="Add a device first"
            body="Add a second trusted device before raising protection."
            cta={{
              href: `/app/secure/${encodeURIComponent(recoveryStr)}/enroll`,
              label: "Add a passkey",
            }}
          />
        )}

      {!blockedByDisconnect &&
        vaultQuery.data &&
        !blockedByMembers &&
        blockedByThreshold && (
          <BlockedNote
            eyebrow="Need another credential"
            title={`Vault is ${currentThreshold} of ${memberCount}`}
            body="This change needs another trusted device or member available in this browser."
          />
        )}

      {!blockedByDisconnect &&
        vaultQuery.data &&
        !blockedByMembers &&
        !blockedByThreshold &&
        blockedByNotMember && (
          <BlockedNote
            eyebrow="Not a member"
            title="Switch to a trusted wallet"
            body="This wallet is not allowed to change protection for this vault."
          />
        )}

      {!blockedByDisconnect &&
        vaultQuery.data &&
        !blockedByMembers &&
        !blockedByThreshold &&
        !blockedByNotMember &&
        stage === "intro" && (
          <IntroStage
            currentThreshold={currentThreshold}
            memberCount={memberCount}
            newThreshold={newThreshold}
            setNewThreshold={setNewThreshold}
            minNew={minNew}
            maxNew={maxNew}
            recoveryShort={`${recoveryStr.slice(0, 4)}…${recoveryStr.slice(-4)}`}
            authMode={authMode}
            setAuthMode={setAuthMode}
            walletIsMember={walletIsMember}
            vaultHasPasskey={vaultHasPasskey}
            webauthnState={webauthnState}
            onContinue={handleRun}
            reduce={!!reduce}
          />
        )}

      {stage === "running" && (
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
                  walletEnabled: authMode === "passkey" && walletIsMember,
                  onPick: handleAddApproval,
                }
              : null
          }
        />
      )}

      {stage === "done" && (
        <DoneStage
          newThreshold={newThreshold}
          memberCount={memberCount}
          txSig={txSig}
          onContinue={() =>
            router.push(`/app/secure/${encodeURIComponent(recoveryStr)}`)
          }
          reduce={!!reduce}
        />
      )}
    </motion.div>
  );
}
