"use client";

// /app/secure/import — bring an existing Solana keypair under
// quorum protection.
//
// Threat model (read this before changing anything):
//
//   The user pastes a 64-byte Solana secret key. ANYONE with that
//   key can drain the wallet. Three failure modes we defend against
//   on this page:
//
//     1. Persistence — secret key landing in localStorage / IDB /
//        analytics / Sentry breadcrumbs. Defenses:
//        - The <textarea> is uncontrolled (ref-only). The raw text
//          never enters React state, so it doesn't get serialised
//          into Server Components / dev-tools snapshots.
//        - The parsed Keypair lives in a `useRef`, not state. We
//          wipe it on unmount, on stage transitions away, and on
//          successful broadcast.
//        - We use `parseSolanaSecretKey` which never logs the input.
//
//     2. Phishing — user pastes their key into a clone of this UI.
//        We can't fully defend, but we put a loud warning + the
//        canonical origin tag on the intro stage so a screenshot of
//        the real flow has identifying anchors.
//
//     3. Network exfiltration — secret never leaves the browser.
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
//   intro    — what'll happen + warning copy + connect-wallet gate
//   compose  — paste key + amount + live address/balance preview
//   review   — final summary card before sign
//   creating — atomic tx (DKG → wait dwallet → sign → submit → confirm)
//   done     — success + explorer + open-vault CTA
//
// One Solana tx, three signers (connected wallet pays fees +
// recovery_id keypair + imported keypair). Three ixs:
//   1. create_recovery (with `creator` = connected wallet)
//   2. transfer_dwallet_authority
//   3. SystemProgram.transfer (imported_key → dwallet PDA)
// Atomic — if anything fails, no funds move.

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  KeyRound,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useConnection, useWallet } from "@/lib/wallet";
import { Button } from "@/components/retail/Button";
import { BackToWallets } from "@/components/retail/BackToWallets";
import { PageEyebrow } from "@/components/retail/PageEyebrow";
import { useToast } from "@/components/ui/Toast";
import {
  createSoloVault,
  fetchVault,
  type CreateVaultStage,
} from "@/lib/ikavery/clearmsig-actions";
import { parseSolanaSecretKey, maskAddress } from "@/lib/secure/import";

const LAMPORTS_PER_SOL = 1_000_000_000n;
/** 5000 lamports per signature × 3 signers (creator + recovery_id + imported). */
const TX_FEE_RESERVE_LAMPORTS = 15_000n;

type Stage = "intro" | "compose" | "review" | "creating" | "done";

interface ParsedKey {
  keypair: Keypair;
  wipe: () => void;
}

interface RunStageInfo {
  id: CreateVaultStage;
  label: string;
  detail: string;
}

const RUN_STAGES: RunStageInfo[] = [
  {
    id: "dkg",
    label: "Generating dWallet",
    detail: "Ika network mints a fresh keypair under quorum protection.",
  },
  {
    id: "wait-dwallet",
    label: "Waiting for confirmation",
    detail: "Solana commits the new dWallet account.",
  },
  {
    id: "build",
    label: "Bundling transaction",
    detail: "Packing create + transfer-authority + funds-move into one tx.",
  },
  {
    id: "sign",
    label: "Sign in your wallet",
    detail: "One signature authorises the whole atomic flow.",
  },
  {
    id: "submit",
    label: "Submitting on Solana",
    detail: "Recording the new vault + moving funds.",
  },
  {
    id: "confirm",
    label: "Finalising",
    detail: "Funds are on their way under quorum protection.",
  },
];

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
  // it. The derivedAddress is held in state for rendering only — it's
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
      // Empty input — wipe any prior parse, reset preview.
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
    // Replace any prior parse — wipe the old one before overwriting
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
    if (wallet.isLedger) {
      toast.error("Ledger not supported yet", {
        details:
          "The vault create flow needs full transaction signing. Use a hot wallet (Dynamic embedded) for now.",
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
        "Imported key matches your connected wallet — that's a self-transfer.",
        {
          details: "Use 'Build a vault' instead — it creates a fresh dWallet without moving funds.",
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

      // Success — clear the paste surface + ref. Action layer already
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
      // Don't wipe the keypair on failure — the user might want to
      // retry without re-pasting. Wipe-on-unmount still applies.
      toast.error("Couldn't import the wallet", {
        details: e instanceof Error ? e.message : String(e),
      });
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
          isLedger={!!wallet.isLedger}
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
            // Connected wallet pays fees, NOT the imported key — so we
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
          toLabel="brand-new dWallet (created in this same tx)"
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

interface IntroStageProps {
  onContinue: () => void;
  walletConnected: boolean;
  isLedger: boolean;
  secureContext: boolean | null;
  reduce: boolean;
}

function IntroStage({
  onContinue,
  walletConnected,
  isLedger,
  secureContext,
  reduce,
}: IntroStageProps) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  const blocked =
    !walletConnected || isLedger || secureContext === false;
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-6"
    >
      <PageEyebrow label="// 02 · import" align="center">
        <span className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <KeyRound className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <h1 className="mt-3 font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          Move funds under quorum protection
        </h1>
        <p className="mx-auto mt-2 max-w-md text-base text-text-soft">
          Got an existing Solana wallet with funds? Paste its secret key and
          we&rsquo;ll create a fresh vault, move the SOL in, and wipe the key
          from memory — all in one atomic Solana transaction.
        </p>
      </PageEyebrow>

      <ul className="mx-auto flex w-full max-w-md flex-col gap-2">
        <FeatureRow
          Icon={ShieldCheck}
          title="Browser-only"
          body="Your secret key never touches a server. We sign locally and broadcast through Solana directly."
        />
        <FeatureRow
          Icon={Sparkles}
          title="One transaction, atomic"
          body="Vault creation and the funds move are bundled. If anything fails, nothing happens — no partial state."
        />
        <FeatureRow
          Icon={KeyRound}
          title="Wiped after use"
          body="Once funds are in the vault, we zero the key buffer in memory. The imported wallet is decommissioned."
        />
      </ul>

      <aside className="mx-auto flex max-w-md items-start gap-3 rounded-card border border-warning/40 bg-warning/[0.06] p-4 text-sm text-text-soft">
        <ShieldAlert
          className="mt-0.5 h-5 w-5 shrink-0 text-warning"
          strokeWidth={2}
          aria-hidden="true"
        />
        <p className="leading-snug">
          <span className="font-medium text-text-strong">
            Anyone with this key drains the wallet.
          </span>{" "}
          Make sure the URL bar reads{" "}
          <span className="font-mono text-[11px] text-text-strong">
            secure-msig.vercel.app
          </span>
          {" "}or your trusted clear-msig host. Don&rsquo;t paste your secret
          key into anything else.
        </p>
      </aside>

      {!walletConnected && (
        <BlockedNote
          title="Connect a wallet first"
          body="The new vault needs an owner — your connected Solana wallet becomes member 0 and pays the tx fee."
          ctaHref="/connect?next=/app/secure/import"
          ctaLabel="Sign in"
        />
      )}
      {walletConnected && isLedger && (
        <BlockedNote
          title="Ledger not supported here"
          body="The import flow needs full transaction signing. Use your Dynamic embedded wallet for now."
        />
      )}
      {secureContext === false && (
        <BlockedNote
          title="HTTPS required"
          body="We refuse to ask for a secret key over plain HTTP. Reload the page over https:// or localhost."
        />
      )}

      <div className="mx-auto flex flex-col items-center gap-2">
        <Button size="lg" onClick={onContinue} disabled={blocked}>
          Continue
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </motion.section>
  );
}

interface ComposeStageProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: () => void;
  derivedAddress: string | null;
  parseError: string | null;
  parseFormat: "base58" | "json" | null;
  isSelfImport: boolean;
  balanceLamports: bigint | null;
  balanceLoading: boolean;
  amountSol: string;
  setAmountSol: (v: string) => void;
  amountError: string | null;
  onMax: () => void;
  onContinue: () => void;
  onBack: () => void;
  reduce: boolean;
}

function ComposeStage(props: ComposeStageProps) {
  const motionProps = props.reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-6"
    >
      <PageEyebrow label="// 02 · import" align="center">
        <h1 className="font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          Paste your secret key
        </h1>
        <p className="mx-auto mt-2 max-w-md text-base text-text-soft">
          Phantom / Solflare export format (base58) or{" "}
          <span className="font-mono text-[12px] text-text-strong">solana-keygen</span>{" "}
          JSON array. We never persist or transmit it.
        </p>
      </PageEyebrow>

      <section className="mx-auto w-full max-w-md flex flex-col gap-4 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="secret-key"
            className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-soft"
          >
            Secret key
          </label>
          {/* Uncontrolled <input type="password"> — the secret never
              enters React state, and `password` is masked across every
              browser (textarea + CSS `text-security:disc` only works
              on WebKit/Blink). Long base58 strings overflow-x naturally;
              JSON arrays still parse because JSON.parse is whitespace
              tolerant.
              No "Show" toggle by design — verifying via the derived
              address (rendered below on parse) is safer than echoing
              the secret onto the user's screen. */}
          <input
            id="secret-key"
            ref={props.inputRef}
            type="password"
            onChange={props.onChange}
            onPaste={props.onChange}
            placeholder="Paste base58 (Phantom / Solflare) or [1,2,3,…,64] JSON"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            data-1p-ignore
            data-lpignore="true"
            className="rounded-soft border border-border-soft bg-canvas px-3 py-2 font-mono text-sm text-text-strong placeholder:text-text-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          {props.parseError && (
            <p className="text-[11px] text-warning">{props.parseError}</p>
          )}
          {props.derivedAddress && (
            <div className="mt-2 flex flex-col gap-1.5 rounded-soft border border-accent/30 bg-accent/[0.04] p-3 text-[11px] text-text-soft">
              <span className="inline-flex items-center gap-1.5 font-medium text-accent">
                <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                Verified · {props.parseFormat === "json" ? "JSON" : "base58"}
              </span>
              <span>
                Derived address:{" "}
                <span className="font-mono text-text-strong">
                  {maskAddress(props.derivedAddress)}
                </span>
              </span>
              <span className="font-numerals tabular-nums">
                Balance:{" "}
                {props.balanceLoading
                  ? "checking…"
                  : props.balanceLamports != null
                    ? `${formatLamportsToSol(props.balanceLamports)} SOL`
                    : "unknown"}
              </span>
            </div>
          )}
          {props.isSelfImport && (
            <p className="text-[11px] text-warning">
              That key matches your connected wallet. Use{" "}
              <Link href="/app/secure/new" className="underline">
                Build a vault
              </Link>{" "}
              instead — there&rsquo;s nothing to import to itself.
            </p>
          )}
        </div>

        {props.derivedAddress && !props.isSelfImport && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-end justify-between gap-2">
              <label
                htmlFor="amount-sol"
                className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-soft"
              >
                Amount (SOL)
              </label>
              {props.balanceLamports != null && (
                <span className="font-numerals text-[10px] tabular-nums text-text-soft">
                  Balance: {formatLamportsToSol(props.balanceLamports)} SOL
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                id="amount-sol"
                type="text"
                inputMode="decimal"
                value={props.amountSol}
                onChange={(e) => props.setAmountSol(e.target.value)}
                placeholder="0.0"
                spellCheck={false}
                autoComplete="off"
                className="flex-1 rounded-soft border border-border-soft bg-canvas px-3 py-2 font-numerals text-base tabular-nums text-text-strong placeholder:text-text-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
              <button
                type="button"
                onClick={props.onMax}
                disabled={props.balanceLamports == null}
                className={
                  "shrink-0 rounded-soft border border-border-soft bg-canvas px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-text-soft " +
                  "transition-[border-color,color] duration-base ease-out-soft hover:border-accent hover:text-accent " +
                  "disabled:cursor-not-allowed disabled:opacity-50 " +
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                }
                title="Move the full imported balance"
              >
                Max
              </button>
            </div>
            {props.amountError && (
              <p className="text-[11px] text-warning">{props.amountError}</p>
            )}
            <p className="text-[10px] text-text-soft">
              Tx fees ({Number(TX_FEE_RESERVE_LAMPORTS) / 1e9} SOL) are paid
              by your connected wallet, not the imported key.
            </p>
          </div>
        )}
      </section>

      <div className="mx-auto flex items-center gap-2">
        <Button
          variant="ghost"
          size="lg"
          onClick={props.onBack}
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </Button>
        <Button
          size="lg"
          onClick={props.onContinue}
          disabled={!props.derivedAddress || props.isSelfImport}
        >
          Review
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </motion.section>
  );
}

interface ReviewStageProps {
  fromAddress: string;
  toLabel: string;
  amountSol: string;
  balanceLamports: bigint | null;
  lamports: bigint | null;
  onBack: () => void;
  onConfirm: () => void;
  reduce: boolean;
}

function ReviewStage(props: ReviewStageProps) {
  const motionProps = props.reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  const remainingSol =
    props.balanceLamports != null && props.lamports != null
      ? formatLamportsToSol(props.balanceLamports - props.lamports)
      : null;
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-6"
    >
      <PageEyebrow label="// 02 · import" align="center">
        <h1 className="font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          Confirm the import
        </h1>
        <p className="mx-auto mt-2 max-w-md text-base text-text-soft">
          One Solana tx, three signatures (you, recovery_id, and the
          imported key — locally). Atomic.
        </p>
      </PageEyebrow>

      <section className="mx-auto w-full max-w-md rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        <dl className="flex flex-col gap-3">
          <Row label="From" value={maskAddress(props.fromAddress)} title={props.fromAddress} />
          <Row label="To" value={props.toLabel} mono={false} />
          <Row label="Amount" value={`${props.amountSol} SOL`} mono={false} />
          {remainingSol != null && (
            <Row
              label="Imported wallet remaining"
              value={`${remainingSol} SOL`}
              mono={false}
            />
          )}
        </dl>
      </section>

      <aside className="mx-auto flex max-w-md items-start gap-3 rounded-card border border-border-soft bg-canvas p-4 text-[11px] text-text-soft">
        <ShieldCheck
          className="mt-0.5 h-4 w-4 shrink-0 text-text-soft"
          strokeWidth={2}
          aria-hidden="true"
        />
        <p className="leading-snug">
          After confirm, we&rsquo;ll wipe the imported key from memory. The
          imported address will show this one final outgoing transaction;
          everything after happens through the new vault.
        </p>
      </aside>

      <div className="mx-auto flex items-center gap-2">
        <Button
          variant="ghost"
          size="lg"
          onClick={props.onBack}
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </Button>
        <Button size="lg" onClick={props.onConfirm}>
          Import + create vault
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </motion.section>
  );
}

interface CreatingStageProps {
  subStage: CreateVaultStage | null;
  reduce: boolean;
}

function CreatingStage({ subStage, reduce }: CreatingStageProps) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  const activeIdx = subStage
    ? RUN_STAGES.findIndex((s) => s.id === subStage)
    : 0;
  const active = activeIdx >= 0 ? RUN_STAGES[activeIdx] : RUN_STAGES[0]!;
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.3 }}
      className="flex flex-col items-center gap-6 px-gutter py-16"
    >
      <Loader2
        className="h-10 w-10 animate-spin text-accent"
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="font-display text-xl font-semibold text-text-strong">
          {active?.label ?? "Importing…"}
        </p>
        <p className="max-w-sm text-sm text-text-soft">
          {active?.detail ?? "Bundling the atomic import tx."}
        </p>
      </div>
      <ol className="flex items-center gap-1.5" aria-label="import progress">
        {RUN_STAGES.map((s, i) => {
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
    </motion.section>
  );
}

interface DoneStageProps {
  recoveryAddress: string | null;
  txSignature: string | null;
  amountSol: string;
  onOpen: () => void;
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
      <PageEyebrow label="// 02 · import" align="center">
        <span className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Check className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
        </span>
        <h1 className="mt-3 font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          Funds protected
        </h1>
        <p className="mx-auto mt-2 max-w-md text-base text-text-soft">
          {props.amountSol} SOL is now under quorum protection. The imported
          key has been wiped from memory; future moves go through the vault.
        </p>
      </PageEyebrow>

      {props.txSignature && (
        <a
          href={`https://explorer.solana.com/tx/${props.txSignature}?cluster=devnet`}
          target="_blank"
          rel="noreferrer"
          className="mx-auto inline-flex min-h-tap items-center gap-1.5 rounded-full border border-border-soft bg-surface-raised px-3 py-1.5 text-[11px] font-medium text-text-soft hover:border-accent hover:text-accent"
        >
          View on Solana Explorer
        </a>
      )}

      <div className="mx-auto flex flex-col items-center gap-2">
        <Button size="lg" onClick={props.onOpen}>
          Open vault
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </motion.section>
  );
}

// ─── Building blocks ─────────────────────────────────────────────────

function FeatureRow({
  Icon,
  title,
  body,
}: {
  Icon: typeof KeyRound;
  title: string;
  body: string;
}) {
  return (
    <li className="flex items-start gap-3 rounded-card border border-border-soft bg-surface-raised p-4">
      <Icon
        className="mt-0.5 h-5 w-5 shrink-0 text-accent"
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <span className="text-sm text-text-soft">
        <span className="font-medium text-text-strong">{title}.</span> {body}
      </span>
    </li>
  );
}

function BlockedNote({
  title,
  body,
  ctaHref,
  ctaLabel,
}: {
  title: string;
  body: string;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <aside className="mx-auto flex max-w-md flex-col gap-2 rounded-card border border-warning/40 bg-warning/[0.06] p-4 text-sm text-text-soft">
      <p className="font-medium text-text-strong">{title}</p>
      <p>{body}</p>
      {ctaHref && ctaLabel && (
        <Link href={ctaHref} className="self-start">
          <Button size="sm">
            {ctaLabel}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </Link>
      )}
    </aside>
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
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-soft">
        {label}
      </dt>
      <dd
        className={
          "text-right text-sm text-text-strong " +
          (mono ? "font-mono" : "")
        }
        title={title}
      >
        {value}
      </dd>
    </div>
  );
}

function formatLamportsToSol(lamports: bigint): string {
  const whole = lamports / LAMPORTS_PER_SOL;
  const frac = lamports % LAMPORTS_PER_SOL;
  const fracStr = frac.toString().padStart(9, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}
