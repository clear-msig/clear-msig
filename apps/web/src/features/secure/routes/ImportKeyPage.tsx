"use client";

// /app/secure/import. Bring an existing Solana keypair under
// quorum protection.
//
// Threat model (read this before changing anything):
//
//   The user pastes a 64-byte Solana secret key. ANYONE with that
//   key can drain the wallet. Three failure modes we defend against
//   on this page:
//
//     1. Persistence. Secret key landing in localStorage / IDB /
//        analytics / Sentry breadcrumbs. Defenses:
//        - The <textarea> is uncontrolled (ref-only). The raw text
//          never enters React state, so it doesn't get serialised
//          into Server Components / dev-tools snapshots.
//        - The parsed Keypair lives in a `useRef`, not state. We
//          wipe it on unmount, on stage transitions away, and on
//          successful broadcast.
//        - We use `parseSolanaSecretKey` which never logs the input.
//
//     2. Phishing. User pastes their key into a clone of this UI.
//        We can't fully defend, but we put a loud warning + the
//        canonical origin tag on the intro stage so a screenshot of
//        the real flow has identifying anchors.
//
//     3. Network exfiltration. Secret never leaves the browser.
//        Defenses:
//        - The Keypair signs locally via web3.js's `tx.sign([kp])`.
//        - The connected wallet popup shows the FINAL tx (with the
//          import sig already filled). The wallet sees the
//          imported pubkey + amount, not the secret.
//        - Pre-flight `isSecureContext` check refuses to proceed if
//          the page isn't HTTPS / localhost.
//
//   What we DON'T defend against (page-level can't):
//     - Browser extensions reading <textarea> contents.
//     - Compromised devices with malware capturing keystrokes.
//     - Session screen-sharing / screen recording.
//
// UX flow:
//   intro   . What'll happen + warning copy + connect-wallet gate
//   compose . Paste key + amount + live address/balance preview
//   review  . Final summary card before sign
//   creating. Atomic tx (DKG → wait dwallet → sign → submit → confirm)
//   done    . Success + explorer + open-vault CTA
//
// One Solana tx, three signers (connected wallet pays fees +
// recovery_id keypair + imported keypair). Three ixs:
//   1. create_recovery (with `creator` = connected wallet)
//   2. transfer_dwallet_authority
//   3. SystemProgram.transfer (imported_key → dwallet PDA)
// Atomic. If anything fails, no funds move.

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import { useConnection, useWallet } from "@/lib/wallet";
import { Button } from "@/components/retail/Button";
import { BackToWallets } from "@/components/retail/BackToWallets";
import { useToast } from "@/components/ui/Toast";
import {
  createSoloVault,
  fetchVault,
  type CreateVaultStage,
} from "@/lib/ikavery/clearmsig-actions";
import { secureActionErrorCopy } from "@/lib/ikavery/errors";
import {
  ComposeStage,
  CreatingStage,
  DoneStage,
  formatLamportsToSol,
  IntroStage,
  ReviewStage,
} from "@/features/secure/routes/ImportKeyStages";
import { parseSolanaSecretKey } from "@/lib/secure/import";

const LAMPORTS_PER_SOL = 1_000_000_000n;
/** 5000 lamports per signature × 3 signers (creator + recovery_id + imported). */
const TX_FEE_RESERVE_LAMPORTS = 15_000n;

type Stage = "intro" | "compose" | "review" | "creating" | "done";

interface ParsedKey {
  keypair: Keypair;
  wipe: () => void;
}

export default function SecureImportPageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen" aria-hidden="true" />}>
      <SecureImportPage />
    </Suspense>
  );
}

function SecureImportPage() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const { connection } = useConnection();
  const wallet = useWallet();
  const toast = useToast();
  const queryClient = useQueryClient();

  // ── Stage + result state ──────────────────────────────────────────
  const [stage, setStage] = useState<Stage>("intro");
  const [createSubStage, setCreateSubStage] =
    useState<CreateVaultStage | null>(null);
  const [resultRecovery, setResultRecovery] = useState<string | null>(null);
  const [resultTxSig, setResultTxSig] = useState<string | null>(null);

  // ── Parsed-key state (NOT in React state) ─────────────────────────
  // Keypair lives in a ref so React's reconciliation never serialises
  // it. The derivedAddress is held in state for rendering only. It's
  // a public pubkey, safe to expose.
  const parsedRef = useRef<ParsedKey | null>(null);
  const [derivedAddress, setDerivedAddress] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parseFormat, setParseFormat] = useState<"base58" | "json" | null>(
    null,
  );

  // ── Amount + balance ──────────────────────────────────────────────
  const [amountSol, setAmountSol] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const balanceQ = useQuery({
    queryKey: ["secure-import-balance", derivedAddress ?? "none"],
    queryFn: async () => {
      if (!derivedAddress) return null;
      return connection.getBalance(new PublicKey(derivedAddress), "confirmed");
    },
    enabled: !!derivedAddress,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
  const balanceLamports = useMemo<bigint | null>(() => {
    if (typeof balanceQ.data !== "number") return null;
    return BigInt(balanceQ.data);
  }, [balanceQ.data]);

  const lamports = useMemo<bigint | null>(() => {
    const trimmed = amountSol.trim();
    if (!trimmed) return null;
    if (!/^\d+(\.\d{0,9})?$/.test(trimmed)) return null;
    const [whole, frac = ""] = trimmed.split(".");
    const fracPadded = (frac + "000000000").slice(0, 9);
    try {
      const w = BigInt(whole ?? "0");
      const f = BigInt(fracPadded || "0");
      const v = w * LAMPORTS_PER_SOL + f;
      if (v <= 0n) return null;
      return v;
    } catch {
      return null;
    }
  }, [amountSol]);

  // ── Pre-flight: HTTPS / secure context ────────────────────────────
  // Refuse to render the paste field at all unless the page is over
  // HTTPS or localhost. WebAuthn + Solana sign already require this
  // for other reasons, but the import flow depends on it specifically
  // because we shouldn't ever ask for a secret key over HTTP.
  const [secureContext, setSecureContext] = useState<boolean | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setSecureContext(
      typeof window.isSecureContext === "boolean"
        ? window.isSecureContext
        : true,
    );
  }, []);

  // ── Aggressive cleanup ─────────────────────────────────────────────
  // Wipe the keypair on unmount + when navigating away from a paste
  // surface. The wipe is idempotent so calling it from multiple
  // cleanup hooks is safe.
  useEffect(() => {
    return () => {
      parsedRef.current?.wipe();
      parsedRef.current = null;
    };
  }, []);

  // Clear input when leaving compose. We defensively also clear the
  // textarea ref's underlying DOM value so the browser autofill cache
  // doesn't replay the previous paste on revisit.
  const inputRef = useRef<HTMLInputElement>(null);
  const clearPasteSurface = () => {
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  // ── Parse-on-change ───────────────────────────────────────────────
  const handleSecretChange = () => {
    const v = inputRef.current?.value ?? "";
    if (!v.trim()) {
      // Empty input. Wipe any prior parse, reset preview.
      parsedRef.current?.wipe();
      parsedRef.current = null;
      setDerivedAddress(null);
      setParseError(null);
      setParseFormat(null);
      return;
    }
    const r = parseSolanaSecretKey(v);
    if (!r.ok) {
      // Wipe prior, but don't show error mid-typing for short inputs
      // (under 32 chars is almost certainly still being pasted).
      parsedRef.current?.wipe();
      parsedRef.current = null;
      setDerivedAddress(null);
      setParseFormat(null);
      setParseError(v.length < 32 ? null : r.reason);
      return;
    }
    // Replace any prior parse. Wipe the old one before overwriting
    // the ref so we don't leak a previous decode on key change.
    if (
      parsedRef.current &&
      !r.keypair.publicKey.equals(parsedRef.current.keypair.publicKey)
    ) {
      parsedRef.current.wipe();
    }
    parsedRef.current = { keypair: r.keypair, wipe: r.wipe };
    setDerivedAddress(r.keypair.publicKey.toBase58());
    setParseFormat(r.format);
    setParseError(null);
  };

  // ── Self-import detection ─────────────────────────────────────────
  const isSelfImport = useMemo(() => {
    if (!derivedAddress || !wallet.publicKey) return false;
    return derivedAddress === wallet.publicKey.toBase58();
  }, [derivedAddress, wallet.publicKey]);

  // ── Stage transitions ─────────────────────────────────────────────
  const handleStartCompose = () => {
    if (!wallet.connected || !wallet.publicKey) {
      toast.error("Connect a wallet first", {
        details:
          "We use the connected wallet as the new vault's member. The imported key is just a one-time funds source.",
      });
      return;
    }
    if (secureContext === false) {
      toast.error("HTTPS required", {
        details:
          "Reload over https:// (or localhost). We refuse to ask for a secret key over plain HTTP.",
      });
      return;
    }
    setStage("compose");
  };

  const handleReview = () => {
    setAmountError(null);
    if (!parsedRef.current) {
      setParseError("Paste a valid secret key to continue.");
      return;
    }
    if (isSelfImport) {
      toast.error(
        "Imported key matches your connected wallet. That's a self-transfer.",
        {
          details: "Use 'Build a vault' instead. It creates a fresh vault without moving funds.",
        },
      );
      return;
    }
    if (!lamports) {
      setAmountError("Enter the amount to move into the vault.");
      return;
    }
    if (balanceLamports != null && lamports > balanceLamports) {
      setAmountError(
        `Amount exceeds the imported wallet's balance (${(Number(balanceLamports) / 1e9).toFixed(4)} SOL).`,
      );
      return;
    }
    setStage("review");
  };

  const handleRun = async () => {
    if (!wallet.connected || !wallet.publicKey || !wallet.signTransaction) {
      toast.error("Connect a wallet first");
      return;
    }
    if (!parsedRef.current || !lamports) return;

    setCreateSubStage("dkg");
    setStage("creating");

    const importKeypair = parsedRef.current.keypair;
    const wipeFn = parsedRef.current.wipe;

    try {
      const result = await createSoloVault({
        connection,
        creator: wallet.publicKey,
        threshold: 1,
        signTransaction: wallet.signTransaction,
        onProgress: (s) => setCreateSubStage(s),
        importFunds: {
          keypair: importKeypair,
          lamports,
          // Action-layer wipe runs the instant `tx.sign` returns, so
          // the secret buffer is zeroed before submit/confirm/Dynamic
          // popup. Page-level wipe below is the redundant safety net.
          wipe: wipeFn,
        },
      });

      // Success. Clear the paste surface + ref. Action layer already
      // wiped the buffer; this is just bookkeeping (idempotent wipe
      // for ironclad path coverage).
      wipeFn();
      parsedRef.current = null;
      clearPasteSurface();
      setDerivedAddress(null);

      setResultRecovery(result.recovery.toBase58());
      setResultTxSig(result.txSignature);
      setCreateSubStage(null);
      setStage("done");

      // Pre-warm the vault detail page so "Open vault" lands on a
      // populated screen. Same pattern as /secure/new.
      const recoveryStr = result.recovery.toBase58();
      const dwalletStr = new PublicKey(result.dwalletPubkey).toBase58();
      void Promise.allSettled([
        queryClient.prefetchQuery({
          queryKey: ["ikavery-vault", recoveryStr],
          queryFn: () => fetchVault(connection, result.recovery),
        }),
        queryClient.setQueryData(
          ["ikavery-dwallet-balance", dwalletStr],
          Number(lamports),
        ),
        queryClient.invalidateQueries({ queryKey: ["ikavery-vaults"] }),
      ]);
    } catch (e) {
      console.error("[secure/import]", e);
      // Don't wipe the keypair on failure. The user might want to
      // retry without re-pasting. Wipe-on-unmount still applies.
      const copy = secureActionErrorCopy(e, "Couldn't import the wallet");
      toast.error(copy.title, { details: copy.details });
      setCreateSubStage(null);
      setStage("review");
    }
  };

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

  // ── Render ────────────────────────────────────────────────────────
  return (
    <motion.div
      {...fadeIn(0)}
      className="mx-auto flex w-full max-w-2xl flex-col gap-8"
    >
      <div className="px-gutter md:hidden">
        <BackToWallets label="Vaults" />
      </div>

      {stage !== "done" && stage !== "creating" && (
        <div className="px-gutter">
          <Link
            href="/app/secure"
            className="inline-flex items-center gap-1.5 text-xs text-text-soft hover:text-text-strong"
          >
            <ArrowLeft className="h-3 w-3" aria-hidden="true" />
            Back to vaults
          </Link>
        </div>
      )}

      {stage === "intro" && (
        <IntroStage
          onContinue={handleStartCompose}
          walletConnected={!!wallet.connected && !!wallet.publicKey}
          secureContext={secureContext}
          reduce={!!reduce}
        />
      )}

      {stage === "compose" && (
        <ComposeStage
          inputRef={inputRef}
          onChange={handleSecretChange}
          derivedAddress={derivedAddress}
          parseError={parseError}
          parseFormat={parseFormat}
          isSelfImport={isSelfImport}
          balanceLamports={balanceLamports}
          balanceLoading={balanceQ.isLoading}
          amountSol={amountSol}
          setAmountSol={setAmountSol}
          amountError={amountError}
          onMax={() => {
            if (balanceLamports == null) return;
            // Connected wallet pays fees, NOT the imported key. So we
            // can transfer the imported key's full balance. The account
            // closes naturally when drained to 0.
            setAmountSol(formatLamportsToSol(balanceLamports));
          }}
          onContinue={handleReview}
          onBack={() => {
            parsedRef.current?.wipe();
            parsedRef.current = null;
            setDerivedAddress(null);
            setParseError(null);
            setParseFormat(null);
            setAmountSol("");
            clearPasteSurface();
            setStage("intro");
          }}
          reduce={!!reduce}
        />
      )}

      {stage === "review" && (
        <ReviewStage
          fromAddress={derivedAddress ?? ""}
          toLabel="new protected vault"
          amountSol={amountSol}
          balanceLamports={balanceLamports}
          lamports={lamports}
          onBack={() => setStage("compose")}
          onConfirm={handleRun}
          reduce={!!reduce}
        />
      )}

      {stage === "creating" && (
        <CreatingStage subStage={createSubStage} reduce={!!reduce} />
      )}

      {stage === "done" && (
        <DoneStage
          recoveryAddress={resultRecovery}
          txSignature={resultTxSig}
          amountSol={amountSol}
          onOpen={() => {
            if (!resultRecovery) return;
            router.push(`/app/secure/${encodeURIComponent(resultRecovery)}`);
          }}
          reduce={!!reduce}
        />
      )}
    </motion.div>
  );
}

// ─── Stages ───────────────────────────────────────────────────────────
