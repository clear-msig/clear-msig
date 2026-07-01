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
  Check,
  Fingerprint,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { useConnection, useWallet } from "@/lib/wallet";
import { Button } from "@/components/retail/Button";
import { BackToWallets } from "@/components/retail/BackToWallets";
import { PageEyebrow } from "@/components/retail/PageEyebrow";
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

const WALLET_RUN_STAGES: {
  id: BumpThresholdStage;
  label: string;
  detail: string;
}[] = [
  {
    id: "stage-sign",
    label: "Confirm change",
    detail: "Your wallet starts the protection change.",
  },
  {
    id: "stage-confirm",
    label: "Saving",
    detail: "Recording the change request.",
  },
  {
    id: "sign",
    label: "Confirm again",
    detail: "Your wallet reviews the new protection level.",
  },
  {
    id: "submit",
    label: "Submitting",
    detail: "Sending the protection request.",
  },
  {
    id: "confirm",
    label: "Confirming",
    detail: "Waiting for the request to settle.",
  },
  {
    id: "approve-sign",
    label: "Approve",
    detail: "Your wallet adds your approval.",
  },
  {
    id: "approve-submit",
    label: "Saving approval",
    detail: "Recording your approval.",
  },
  {
    id: "approve-confirm",
    label: "Confirming approval",
    detail: "Waiting for your approval to settle.",
  },
  {
    id: "collecting-approvals",
    label: "Collecting extra approvals",
    detail: "Ask another trusted device or member to approve.",
  },
  {
    id: "execute-sign",
    label: "Finish change",
    detail: "Your wallet applies the new protection level.",
  },
  {
    id: "execute-confirm",
    label: "Finalising",
    detail: "Saving the new protection level.",
  },
];

const PASSKEY_RUN_STAGES: {
  id: BumpThresholdStage;
  label: string;
  detail: string;
}[] = [
  {
    id: "stage-sign",
    label: "Confirm change",
    detail: "Your wallet starts the protection change.",
  },
  {
    id: "stage-confirm",
    label: "Saving",
    detail: "Recording the change request.",
  },
  {
    id: "propose-passkey",
    label: "Tap passkey",
    detail: "Approve the protection change.",
  },
  {
    id: "sign",
    label: "Confirm in wallet",
    detail: "Your wallet reviews the request.",
  },
  {
    id: "submit",
    label: "Submitting",
    detail: "Sending the protection request.",
  },
  {
    id: "confirm",
    label: "Confirming",
    detail: "Waiting for the request to settle.",
  },
  {
    id: "approve-passkey",
    label: "Tap your passkey · approve",
    detail: "Authorise the approve challenge.",
  },
  {
    id: "approve-sign",
    label: "Confirm approval",
    detail: "Your wallet records the approval.",
  },
  {
    id: "approve-submit",
    label: "Saving approval",
    detail: "Recording the approval.",
  },
  {
    id: "approve-confirm",
    label: "Confirming approval",
    detail: "Waiting for the approval to settle.",
  },
  {
    id: "collecting-approvals",
    label: "Collecting extra approvals",
    detail: "Ask another trusted device or member to approve.",
  },
  {
    id: "execute-sign",
    label: "Finish change",
    detail: "Your wallet applies the new protection level.",
  },
  {
    id: "execute-confirm",
    label: "Finalising",
    detail: "Saving the new protection level.",
  },
];

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

interface IntroStageProps {
  currentThreshold: number;
  memberCount: number;
  newThreshold: number;
  setNewThreshold: (n: number) => void;
  minNew: number;
  maxNew: number;
  recoveryShort: string;
  authMode: BumpAuthMode;
  setAuthMode: (m: BumpAuthMode) => void;
  walletIsMember: boolean;
  vaultHasPasskey: boolean;
  webauthnState:
    | null
    | { ok: true }
    | { ok: false; reason: "insecure" | "unavailable" };
  onContinue: () => void;
  reduce: boolean;
}

function IntroStage({
  currentThreshold,
  memberCount,
  newThreshold,
  setNewThreshold,
  minNew,
  maxNew,
  recoveryShort,
  authMode,
  setAuthMode,
  walletIsMember,
  vaultHasPasskey,
  webauthnState,
  onContinue,
  reduce,
}: IntroStageProps) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  const options: number[] = [];
  for (let i = minNew; i <= maxNew; i++) options.push(i);
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-6"
    >
      <PageEyebrow label="// 06 · roster" align="center">
        <h1 className="font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          Lock down vault {recoveryShort}
        </h1>
        <p className="mx-auto mt-2 max-w-md text-base text-text-soft">
          Choose how many trusted approvals are needed before funds can move.
        </p>
      </PageEyebrow>

      <section className="mx-auto w-full max-w-md flex flex-col gap-4 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-soft">
          New protection
        </p>
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {options.map((n) => (
            <li key={n}>
              <button
                type="button"
                onClick={() => setNewThreshold(n)}
                aria-pressed={n === newThreshold}
                className={
                  "w-full min-h-tap rounded-soft border bg-canvas px-3 py-2 font-numerals text-base font-semibold tabular-nums " +
                  "transition-[border-color,background-color,color] duration-base ease-out-soft " +
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
                  (n === newThreshold
                    ? "border-accent bg-accent/[0.06] text-accent"
                    : "border-border-soft text-text-strong hover:border-accent/40")
                }
              >
                {n}
                <span className="font-display text-[10px] font-medium tracking-normal text-text-soft">
                  {" of "}
                  {memberCount}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="rounded-soft border border-border-soft bg-canvas p-3 text-[11px] text-text-soft">
          <span className="font-medium text-text-strong">
            {currentThreshold} → {newThreshold}.
          </span>{" "}
          {currentThreshold === 1
            ? "Today any device can sweep solo. After the change, "
            : ""}
          {newThreshold} of {memberCount} approvals will be required for
          recovery actions.
        </div>
      </section>

      {/* Auth picker. Shown only when both options are viable. If
          the wallet isn't a roster member but the vault has a passkey,
          we silently use passkey. If only wallet is viable, no picker. */}
      {walletIsMember && vaultHasPasskey && (
        <section className="mx-auto w-full max-w-md flex flex-col gap-2 rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-soft">
            Authorise as
          </p>
          <div className="grid grid-cols-2 gap-2">
            <AuthOption
              active={authMode === "wallet"}
              onClick={() => setAuthMode("wallet")}
              label="Wallet"
              detail="Use the connected wallet."
            />
            <AuthOption
              active={authMode === "passkey"}
              onClick={() => setAuthMode("passkey")}
              label="Existing passkey"
              detail="Use a trusted passkey."
            />
          </div>
        </section>
      )}
      {!walletIsMember && authMode === "passkey" && (
        <p className="mx-auto max-w-md text-center text-[11px] text-text-soft">
          Connected wallet isn&rsquo;t on this vault&rsquo;s roster. Bumping
          via an existing passkey.
        </p>
      )}

      {/* Pre-flight WebAuthn warning, only relevant in passkey mode. */}
      {authMode === "passkey" && webauthnState && !webauthnState.ok && (
        <aside className="mx-auto flex max-w-md items-start gap-3 rounded-card border border-warning/40 bg-warning/[0.06] p-4 text-sm text-text-soft">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-warning"
            strokeWidth={2}
            aria-hidden="true"
          />
          <p className="leading-snug">
            <span className="font-medium text-text-strong">
              Passkeys aren&rsquo;t available here.
            </span>{" "}
            {webauthnState.reason === "insecure"
              ? "Passkeys need a secure browser tab. Reload over https:// or localhost and try again."
              : "Passkeys are not available in this browser. Try Chrome, Safari, or Edge in a normal tab."}
          </p>
        </aside>
      )}

      <div className="mx-auto flex flex-col items-center gap-2">
        <Button
          size="lg"
          onClick={onContinue}
          disabled={authMode === "passkey" && webauthnState?.ok === false}
        >
          {authMode === "passkey" ? (
            <>
              <Fingerprint className="h-4 w-4" aria-hidden="true" />
              Lock to {newThreshold} of {memberCount}
            </>
          ) : (
            <>
              Lock to {newThreshold} of {memberCount}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </>
          )}
        </Button>
        <p className="text-[11px] text-text-soft">
          {authMode === "passkey"
            ? "ClearSig will ask for the passkey and wallet confirmations it needs."
            : "ClearSig will ask for each confirmation as the protection changes."}
        </p>
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
      <span className="font-display text-sm font-semibold text-text-strong">
        {label}
      </span>
      <span className="text-[11px] text-text-soft">{detail}</span>
    </button>
  );
}

interface CollectStateProps {
  count: number;
  threshold: number;
  busy: boolean;
  error: string | null;
  walletEnabled: boolean;
  onPick: (mode: BumpAuthMode) => void;
}

interface RunningStageProps {
  subStage: BumpThresholdStage | null;
  authMode: BumpAuthMode;
  reduce: boolean;
  collect: CollectStateProps | null;
}

function RunningStage({ subStage, authMode, reduce, collect }: RunningStageProps) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  const stages =
    authMode === "passkey" ? PASSKEY_RUN_STAGES : WALLET_RUN_STAGES;
  const activeIdx = subStage ? stages.findIndex((s) => s.id === subStage) : 0;
  const active = activeIdx >= 0 ? stages[activeIdx] : stages[0]!;
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.3 }}
      className="flex flex-col items-center gap-6 px-gutter py-16"
    >
      {collect ? (
        <>
          <div className="flex flex-col items-center gap-1 text-center">
            <p className="font-display text-xl font-semibold text-text-strong">
              {collect.count} of {collect.threshold} approvals
            </p>
            <p className="max-w-sm text-sm text-text-soft">
              One approval is in. Use a different trusted device or member
              for each remaining approval.
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
                  : "The connected wallet already approved"
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
              Approve with wallet
              {!collect.walletEnabled && (
                <span className="font-mono text-[10px] text-text-soft">
                  (already used)
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
              Approve with passkey
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
              {active?.label ?? "Bumping…"}
            </p>
            <p className="max-w-sm text-sm text-text-soft">
              {active?.detail ?? "Saving the protection change."}
            </p>
          </div>
          <ol className="flex items-center gap-1.5" aria-label="bump progress">
            {stages.map((s, i) => {
              const completed = activeIdx > i;
              const current = activeIdx === i;
              return (
                <li
                  key={s.id}
                  aria-label={s.label}
                  className={
                    "h-1.5 w-8 rounded-full " +
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
  newThreshold: number;
  memberCount: number;
  txSig: string | null;
  onContinue: () => void;
  reduce: boolean;
}

function DoneStage(props: DoneStageProps) {
  const motionProps = props.reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-6"
    >
      <PageEyebrow label="Protection" align="center">
        <span className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Check className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
        </span>
        <h1 className="mt-3 font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          Locked down
        </h1>
        <p className="mx-auto mt-2 max-w-md text-base text-text-soft">
          Vault is now{" "}
          <span className="font-numerals tabular-nums text-text-strong">
            {props.newThreshold}
          </span>{" "}
          of{" "}
          <span className="font-numerals tabular-nums text-text-strong">
            {props.memberCount}
          </span>
          . Recovery actions now need that many approvals.
        </p>
      </PageEyebrow>

      {props.txSig && (
        <a
          href={`https://explorer.solana.com/tx/${props.txSig}?cluster=devnet`}
          target="_blank"
          rel="noreferrer"
          className="mx-auto inline-flex min-h-tap items-center gap-1.5 rounded-full border border-border-soft bg-surface-raised px-3 py-1.5 text-[11px] font-medium text-text-soft hover:border-accent hover:text-accent"
        >
          View on Solana Explorer
        </a>
      )}

      <div className="mx-auto flex flex-col items-center gap-2">
        <Button size="lg" onClick={props.onContinue}>
          Back to vault
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </motion.section>
  );
}

function BlockedNote({
  eyebrow,
  title,
  body,
  cta,
}: {
  eyebrow: string;
  title: string;
  body: string;
  cta?: { href: string; label: string };
}) {
  return (
    <PageEyebrow label={eyebrow} align="center">
      <span className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
        <ShieldCheck className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <h1 className="mt-3 font-display text-display-sm leading-[1.05] text-text-strong">
        {title}
      </h1>
      <p className="mx-auto mt-2 max-w-md text-base text-text-soft">{body}</p>
      {cta && (
        <Link href={cta.href} className="mt-5 inline-flex">
          <Button size="lg">
            {cta.label}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </Link>
      )}
    </PageEyebrow>
  );
}
