"use client";

// /app/secure/new - wizard for creating a new ikavery vault.
// (Route is /new, not /build, because the frontend's .gitignore
// has `build/` from a Next.js convention and would have hidden the
// file. Naming matches /app/wallet/[name]/policies/new.)
//
// Three user-facing stages, mirroring the existing /welcome
// create-wallet wizard:
//   1. shape    - pick a threshold preset (just-me / 2-of-3 / 3-of-5).
//   2. confirm  - preview card showing what we're about to sign and
//                 the "Build vault" CTA.
//   3. done     - success state + "Open vault" / "Build another".
//
// The "creating" sub-stage sits between confirm and done; it's not a
// user-driven step, just the engine running. The top stage strip
// folds it into "Confirm" so the user sees three big stages, not
// four.
//
// One signed write: the create_recovery instruction. Two signers in
// the tx - the user's connected wallet (creator + payer) and a
// throwaway recoveryId keypair (PDA seed). The throwaway is generated
// client-side and never referenced again.

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@/lib/wallet";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui/Toast";
import {
  createMultiMemberVault,
  createSoloVault,
  fetchVault,
  type CreatePasskeyProgress,
  type CreateVaultStage,
} from "@/lib/ikavery/clearmsig-actions";
import { secureActionErrorCopy } from "@/lib/ikavery/errors";
import { detectWebauthnAvailability } from "@/lib/ikavery/webauthn";
import {
  BlockedDisconnect,
  ConfirmStage,
  CreatingStage,
  DoneStage,
  SHAPES,
  ShapeStage,
  StageStrip,
  type Stage,
  type ThresholdShape,
} from "@/features/secure/routes/NewRecoveryStages";

export default function SecureBuildPageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen" aria-hidden="true" />}>
      <SecureBuildPage />
    </Suspense>
  );
}

function SecureBuildPage() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const { connection } = useConnection();
  const wallet = useWallet();
  const toast = useToast();
  const queryClient = useQueryClient();

  // Preselect the threshold shape when the user lands here from
  // /app/wallet/new's "Recover" branch (?preselect=solo|2of3|3of5).
  // When set, we skip the in-page shape picker and jump straight to
  // the confirm step — the user already made that choice on the
  // unified wallet-create entry. See Fesal feedback 2026-05-11.
  const searchParams = useSearchParams();
  const preselectedShape = useMemo<ThresholdShape | null>(() => {
    const id = searchParams?.get("preselect");
    if (!id) return null;
    return SHAPES.find((s) => s.id === id) ?? null;
  }, [searchParams]);

  const [stage, setStage] = useState<Stage>(
    preselectedShape ? "confirm" : "shape",
  );
  const [shape, setShape] = useState<ThresholdShape>(
    preselectedShape ?? SHAPES[0]!,
  );
  const [resultRecovery, setResultRecovery] = useState<string | null>(null);
  const [resultTxSig, setResultTxSig] = useState<string | null>(null);
  const [passkeyProgress, setPasskeyProgress] = useState<CreatePasskeyProgress | null>(null);
  const [createSubStage, setCreateSubStage] = useState<CreateVaultStage | null>(
    null,
  );
  const webauthn = useMemo(
    () =>
      detectWebauthnAvailability({
        isSecureContext:
          typeof window !== "undefined" ? window.isSecureContext : undefined,
        hasCredentialsCreate:
          typeof navigator !== "undefined" &&
          !!navigator.credentials &&
          typeof navigator.credentials.create === "function",
        hasCredentialsGet:
          typeof navigator !== "undefined" &&
          !!navigator.credentials &&
          typeof navigator.credentials.get === "function",
      }),
    [],
  );
  const passkeysAvailable = webauthn.ok;

  useEffect(() => {
    if (passkeysAvailable || shape.members === 1 || stage === "creating" || stage === "done") {
      return;
    }
    setShape(SHAPES[0]!);
    setStage("shape");
  }, [passkeysAvailable, shape.members, stage]);

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

  const handleConfirm = () => {
    setStage("confirm");
  };

  const handleBuild = async () => {
    if (!wallet.connected || !wallet.publicKey || !wallet.signTransaction) {
      toast.error("Connect a wallet first");
      return;
    }
    if (shape.members > 1) {
      const webauthn = detectWebauthnAvailability({
        isSecureContext:
          typeof window !== "undefined" ? window.isSecureContext : undefined,
        hasCredentialsCreate:
          typeof navigator !== "undefined" &&
          !!navigator.credentials &&
          typeof navigator.credentials.create === "function",
        hasCredentialsGet:
          typeof navigator !== "undefined" &&
          !!navigator.credentials &&
          typeof navigator.credentials.get === "function",
      });
      if (!webauthn.ok) {
        toast.error("Shared vaults need passkeys", {
          details:
            webauthn.reason === "insecure"
              ? "Open ClearSig over HTTPS, then create the vault again."
              : "Use Chrome, Safari, or Edge in a normal browser tab, or choose Just me for now.",
        });
        return;
      }
    }
    // For multi-member shapes, the wizard fires `memberCount - 1`
    // passkey-create prompts back-to-back BEFORE DKG. Set the initial
    // sub-stage accordingly so the UI shows "Creating passkey 1 of N"
    // straight away instead of the DKG copy.
    setCreateSubStage(shape.members > 1 ? "create-passkey" : "dkg");
    setPasskeyProgress(null);
    setStage("creating");
    try {
      const result =
        shape.members === 1
          ? await createSoloVault({
              connection,
              creator: wallet.publicKey,
              threshold: shape.threshold,
              signTransaction: wallet.signTransaction,
              onProgress: (s) => setCreateSubStage(s),
            })
          : await createMultiMemberVault({
              connection,
              creator: wallet.publicKey,
              threshold: shape.threshold,
              memberCount: shape.members,
              signTransaction: wallet.signTransaction,
              onProgress: (s) => setCreateSubStage(s),
              onPasskeyProgress: (p) => setPasskeyProgress(p),
            });
      setResultRecovery(result.recovery.toBase58());
      setResultTxSig(result.txSignature);
      setCreateSubStage(null);
      setStage("done");

      // Pre-warm the vault detail page so clicking "Open vault" lands
      // on a populated page instead of the read-vault skeleton. Three
      // queries to fill, all in parallel:
      //   - vault account (already fetched once in the create flow,
      //     but persist into the listing's queryKey shape)
      //   - dwallet balance (0 lamports. We know this for a brand-new
      //     dWallet)
      //   - proposals list (empty. ProposalCount is 0)
      // All best-effort; failures are silent because the destination
      // page will refetch anyway.
      const recoveryStr = result.recovery.toBase58();
      const dwalletStr = new PublicKey(result.dwalletPubkey).toBase58();
      void Promise.allSettled([
        queryClient.prefetchQuery({
          queryKey: ["ikavery-vault", recoveryStr],
          queryFn: () => fetchVault(connection, result.recovery),
        }),
        queryClient.setQueryData(
          ["ikavery-dwallet-balance", dwalletStr],
          0,
        ),
        queryClient.setQueryData(
          ["ikavery-proposals", recoveryStr, 0],
          [],
        ),
        // Bust the listing query so the new vault shows up after the
        // user backs out, rather than waiting for the next focus-refetch.
        queryClient.invalidateQueries({
          queryKey: ["ikavery-vaults"],
        }),
      ]);
    } catch (e) {
      console.error("[secure/build]", e);
      const copy = secureActionErrorCopy(e, "Couldn't build the vault");
      toast.error(copy.title, { details: copy.details });
      setCreateSubStage(null);
      setPasskeyProgress(null);
      setStage("confirm");
    }
  };

  // Upfront gates so the user can't get stuck halfway through.
  // The wizard needs a connected wallet that can sign transactions.
  const blockedByDisconnect = !wallet.connected;
  const isBlocked = blockedByDisconnect;

  return (
    <motion.div
      {...fadeIn(0)}
      className="mx-auto flex w-full max-w-2xl flex-col gap-8"
    >
      {/* Stage progress strip - hidden when blocked / on done. The
          done state has its own resolution; the blocked states are
          terminal screens that don't need the strip. */}
      {!isBlocked && stage !== "done" && (
        <StageStrip stage={stage} />
      )}

      {blockedByDisconnect && <BlockedDisconnect />}
      {!isBlocked && stage === "shape" && (
        <ShapeStage
          shape={shape}
          setShape={setShape}
          onContinue={handleConfirm}
          reduce={!!reduce}
          passkeysAvailable={passkeysAvailable}
        />
      )}
      {!isBlocked && stage === "confirm" && (
        <ConfirmStage
          shape={shape}
          creatorAddress={wallet.publicKey?.toBase58() ?? ""}
          onBack={() => setStage("shape")}
          onBuild={handleBuild}
          reduce={!!reduce}
          passkeysAvailable={passkeysAvailable}
        />
      )}
      {!isBlocked && stage === "creating" && (
        <CreatingStage
          reduce={!!reduce}
          subStage={createSubStage}
          passkeyProgress={passkeyProgress}
        />
      )}
      {stage === "done" && (
        <DoneStage
          recoveryAddress={resultRecovery}
          txSignature={resultTxSig}
          onOpen={() => {
            if (!resultRecovery) return;
            router.push(`/app/secure/${encodeURIComponent(resultRecovery)}`);
          }}
          onBuildAnother={() => {
            setResultRecovery(null);
            setResultTxSig(null);
            setStage("shape");
          }}
          reduce={!!reduce}
        />
      )}
    </motion.div>
  );
}

// ─── Stage progress strip ─────────────────────────────────────────
//
// Three pill nodes connected by a thin rail. The active node is
// filled accent; past nodes carry a check; future nodes are dim.
// Folds the "creating" sub-stage into "Confirm" so the user sees a
// 3-step product flow, not 4.
