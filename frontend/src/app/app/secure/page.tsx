"use client";

// /app/secure - Secure: ikavery-powered personal key recovery, integrated
// inside clear-msig.
//
// What this page does:
//   - Reads the user's existing vaults via listVaultsForCreator (fast,
//     one getProgramAccounts call).
//   - When the user has none: shows the explainer + build-a-vault CTA
//     (the v1 promo is now the empty state).
//   - When the user has some: renders a list of vault cards with
//     threshold + member count + status, and tucks the explainer
//     beneath as background.
//   - Always shows the trio of "what you can do" tiles: Build,
//     Add device, Sweep, and threshold lock-down.
//
// Visual treatment:
//   - Split hero on lg+ (copy left, illustrative mockup right) so the
//     page lands with a focal product visual instead of just centered
//     text. Mobile collapses to a single centered column.
//   - Cards share rhythm with /app/wallet's hub via the same surface
//     tokens (border-border-soft, bg-surface-raised, shadow-card-rest).
//   - Three-step "how it works" row uses a continuous accent line
//     between the tiles so the reader follows the flow.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  Fingerprint,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldAlert,
  Vault as VaultIcon,
} from "lucide-react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@/lib/wallet";
import { Button } from "@/components/retail/Button";
import { UsdHint } from "@/components/retail/UsdHint";
import { listVaultsForCreator } from "@/lib/ikavery/clearmsig-actions";
import { type DecodedRecovery } from "@/lib/ikavery/discovery";
import { loadAttestation } from "@/lib/ikavery/clearmsig-attestations";
import { listProposals } from "@/lib/ikavery/proposals";
import { STATUS_ACTIVE, STATUS_APPROVED } from "@/lib/ikavery/constants";

const IKAVERY_GITHUB = "https://github.com/Iamknownasfesal/ikavery";

export default function SecurePage() {
  const reduce = useReducedMotion();
  const { connection } = useConnection();
  const wallet = useWallet();
  const creator = wallet.publicKey;
  const creatorB58 = creator?.toBase58() ?? "";

  // listVaultsForCreator hits getProgramAccounts; cache + pause when
  // the user isn't connected so we don't spam the RPC.
  // refetchOnWindowFocus is set explicitly here (overriding the
  // global default that's `false` in AppProviders) so a user
  // coming back from /app/secure/new sees their freshly-created
  // vault without a manual reload.
  const vaultsQuery = useQuery({
    queryKey: ["ikavery-vaults", creatorB58],
    queryFn: () => {
      if (!creator) return Promise.resolve<DecodedRecovery[]>([]);
      return listVaultsForCreator(connection, creator);
    },
    enabled: !!creator && wallet.connected,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const vaults = vaultsQuery.data ?? [];
  const hasVaults = vaults.length > 0;

  const fadeIn = (delay = 0) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 10 },
          animate: { opacity: 1, y: 0 },
          transition: {
            duration: 0.45,
            delay,
            ease: [0.22, 1, 0.36, 1] as const,
          },
        };

  // Two layout paths so returning users land directly on their
  // vaults (no marketing hero / illustration to scroll past) and
  // first-time users still get the explainer + onboarding flow.
  const showVaultsFirst = wallet.connected && hasVaults;

  return (
    <motion.div
      {...fadeIn(0)}
      className="flex flex-col gap-10 sm:gap-12"
    >
      {showVaultsFirst ? (
        <VaultsHero
          vaults={vaults}
          loading={vaultsQuery.isFetching && !vaultsQuery.isLoading}
          onRefresh={() => void vaultsQuery.refetch()}
          fadeIn={fadeIn}
        />
      ) : (
        <>
          {/* ── Marketing hero ──────────────────────────────────
           * Only renders for first-time users (zero vaults / not
           * connected). Returning users see VaultsHero above. */}
          <section className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-12">
            <motion.div
              {...fadeIn(0.04)}
              className="text-center lg:col-span-7 lg:text-left"
            >
              <span className="inline-flex items-center rounded-full border border-border-soft bg-surface-raised px-3 py-1.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-text-soft">
                  Secure · powered by Ika
                </span>
              </span>
              <h1 className="mt-5 font-display text-display-lg leading-[1] tracking-[-0.03em] text-text-strong text-balance sm:text-display-xl">
                Threshold-signed
                <br className="hidden sm:block" />{" "}
                <span className="text-text-soft">key custody.</span>
              </h1>
              <div className="mt-7 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
                <Link href="/app/secure/new" className="inline-block">
                  <Button size="lg">
                    Secure your key
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </Link>
                <Link href="/app/secure/import" className="inline-block">
                  <Button variant="ghost" size="lg">
                    Import key
                  </Button>
                </Link>
              </div>
            </motion.div>

            <motion.div
              {...fadeIn(0.12)}
              className="relative mx-auto w-full max-w-md lg:col-span-5 lg:max-w-none"
            >
              <VaultMockup />
            </motion.div>
          </section>

          {/* State block - empty CTA, loader, error, or sign-in. */}
          {!wallet.connected && <ConnectCallout />}
          {wallet.connected && vaultsQuery.isLoading && (
            <VaultListSkeleton />
          )}
          {wallet.connected && vaultsQuery.isError && (
            <ErrorCallout
              message={
                vaultsQuery.error instanceof Error
                  ? vaultsQuery.error.message
                  : String(vaultsQuery.error)
              }
              onRetry={() => vaultsQuery.refetch()}
            />
          )}
          {!hasVaults &&
            wallet.connected &&
            !vaultsQuery.isLoading &&
            !vaultsQuery.isError && (
              <motion.section
                {...fadeIn(0.08)}
                className="relative overflow-hidden rounded-card border border-accent/40 bg-accent/[0.04] shadow-card-rest"
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full"
                  style={{
                    background:
                      "radial-gradient(circle, var(--clear-accent-glow-rest) 0%, transparent 70%)",
                    filter: "blur(40px)",
                  }}
                />
                <div className="relative grid grid-cols-1 gap-5 p-6 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-8 sm:p-8">
                  <div>
                    <span className="inline-flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="block h-px w-8 bg-accent"
                      />
                      <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">
                        First vault
                      </span>
                    </span>
                    <h2 className="mt-3 font-display text-display-xs leading-tight tracking-[-0.02em] text-text-strong">
                      Create your first vault
                    </h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href="/app/secure/new" className="inline-block">
                      <Button size="lg">
                        Secure your key
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </Link>
                    <Link href="/app/secure/import" className="inline-block">
                      <Button variant="ghost" size="lg">
                        Import key
                      </Button>
                    </Link>
                  </div>
                </div>
              </motion.section>
            )}

        </>
      )}

      {/* Pre-alpha disclosure - rendered on every state. */}
      <motion.aside
        {...fadeIn(0.2)}
        className="flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised/60 p-3 text-xs text-text-soft"
      >
        <ShieldAlert
          className="h-4 w-4 shrink-0 text-warning"
          strokeWidth={2}
          aria-hidden="true"
        />
        <p>
          <span className="font-medium text-text-strong">
            Pre-alpha. Devnet only.
          </span>
          {" · "}
          <a
            href={IKAVERY_GITHUB}
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:text-accent-hover"
          >
            ikavery
          </a>
        </p>
      </motion.aside>
    </motion.div>
  );
}

// ─── Vault-list-first hero ────────────────────────────────────────
//
// What returning users see first when they hit /app/secure. No
// marketing illustration, no scroll. Compact header with the count,
// a "Build another" primary CTA, then the vault cards. The "How it
// works" explainer is intentionally suppressed for this state - if
// you have vaults, you already know what they are.

interface VaultsHeroProps {
  vaults: DecodedRecovery[];
  loading: boolean;
  onRefresh: () => void;
  fadeIn: (delay?: number) => Record<string, unknown>;
}

function VaultsHero({ vaults, loading, onRefresh, fadeIn }: VaultsHeroProps) {
  const count = vaults.length;
  return (
    <>
      <motion.header
        {...fadeIn(0.04)}
        className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between sm:gap-6"
      >
        <div className="min-w-0">
          <span className="inline-flex items-center rounded-full border border-border-soft bg-surface-raised px-3 py-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-text-soft">
              Secure · powered by Ika
            </span>
          </span>
          <h1 className="mt-4 font-display text-display-md leading-[1.02] tracking-[-0.03em] text-text-strong sm:text-display-lg">
            Your vaults
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-text-soft sm:text-[15px]">
            {count}{" "}
            {count === 1 ? "vault" : "vaults"} under quorum custody.
          </p>
        </div>

        {/* Action cluster - primary "Build another" + refresh chip.
            Stacks below the title on mobile, sits on the right on sm+. */}
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh vaults"
            title="Refresh vaults"
            className={
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border-soft bg-surface-raised text-text-soft " +
              "transition-[border-color,color] duration-base ease-out-soft hover:border-accent hover:text-accent " +
              "disabled:cursor-not-allowed disabled:opacity-50 " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            }
          >
            <RefreshCw
              className={"h-4 w-4 " + (loading ? "animate-spin" : "")}
              aria-hidden="true"
            />
          </button>
          <Link href="/app/secure/import" className="inline-block">
            <Button variant="ghost" size="lg">
              <KeyRound className="h-4 w-4" aria-hidden="true" />
              Import key
            </Button>
          </Link>
          <Link href="/app/secure/new" className="inline-block">
            <Button size="lg">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Build another
            </Button>
          </Link>
        </div>
      </motion.header>

      <motion.ul {...fadeIn(0.08)} className="flex flex-col gap-2">
        {vaults.map((v) => (
          <VaultCard key={v.recovery.toBase58()} vault={v} />
        ))}
      </motion.ul>
    </>
  );
}

// ─── Hero illustration ─────────────────────────────────────────────
//
// VaultMockup - a stylised product card showing the threshold concept
// at a glance: a central "vault" tile, three "device share" rows
// (two signed, one waiting), a threshold pill, and a soft accent
// glow. Pure presentational; no data, no state.

// ─── Hero illustration ─────────────────────────────────────────────
//
// VaultMockup - cycles through a live threshold-signing demo on a
// ~6.5s loop while in view. Tells the whole product story (idle →
// signatures land one by one → threshold met → celebration) without
// the reader having to scan the steps below.
//
//   step 0 - idle. 0/3 signed. Vault dim.
//   step 1 - MacBook Pro signing.
//   step 2 - MacBook signed, iPhone signing.
//   step 3 - threshold met (2/3). YubiKey stays "optional", a
//            "Recovery ready" pill animates in, the vault icon
//            picks up an extra ring pulse, the card border glows.
//   → loops back to 0.
//
// Continuous: a subtle vertical float on the whole card and a
// double-ring pulse on the vault icon, both gated by reduced-motion.

const VAULT_SHARES = [
  { name: "MacBook Pro", kind: "Secure Enclave" },
  { name: "iPhone 15", kind: "Touch ID passkey" },
  { name: "YubiKey 5C", kind: "Hardware key" },
] as const;

const VAULT_THRESHOLD = 2;
const STEP_HOLD_MS = [1500, 1500, 1500, 2600];

function VaultMockup() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement | null>(null);
  const inView = useInView(ref, { amount: 0.35, once: false });
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (reduce) {
      setStep(3);
      return;
    }
    if (!inView) return;
    const t = setTimeout(
      () => setStep((s) => (s + 1) % 4),
      STEP_HOLD_MS[step],
    );
    return () => clearTimeout(t);
  }, [step, inView, reduce]);

  // Per-row state. Step 3 is "threshold met" - the YubiKey row
  // intentionally stays pending to teach the 2-of-3 model.
  function rowState(i: number): "pending" | "signing" | "signed" {
    if (step === 3) return i < VAULT_THRESHOLD ? "signed" : "pending";
    if (i < step) return "signed";
    if (i === step) return "signing";
    return "pending";
  }

  const signedCount = step === 3 ? VAULT_THRESHOLD : step;
  const progressPct = (signedCount / VAULT_SHARES.length) * 100;
  const thresholdMet = signedCount >= VAULT_THRESHOLD;

  // Card float - very gentle Y oscillation while in view. Drives
  // home that the card is "live", not a static screenshot.
  const floatAnim = reduce
    ? {}
    : {
        animate: { y: [0, -4, 0] },
        transition: {
          duration: 5.5,
          ease: [0.4, 0, 0.6, 1] as const,
          repeat: Infinity,
        },
      };

  return (
    <div ref={ref} className="relative">
      {/* Ambient accent glow - softens further when the threshold
          is not yet met so the celebration lands harder. */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-10 -z-10 rounded-[3rem]"
        animate={{ opacity: thresholdMet ? 0.85 : 0.45 }}
        transition={{ duration: 0.8 }}
        style={{
          background:
            "radial-gradient(circle at 30% 25%, var(--clear-accent-glow-rest) 0%, transparent 55%)",
          filter: "blur(56px)",
        }}
      />

      <motion.article
        {...floatAnim}
        className="vault-mockup-scan relative overflow-hidden rounded-card border bg-surface-raised shadow-card-rest"
        style={{
          // Border picks up the accent when threshold met for an
          // extra "armed" feel. CSS var so light/dark tokens work.
          borderColor: thresholdMet
            ? "color-mix(in srgb, var(--accent) 50%, transparent)"
            : undefined,
          transition: "border-color 0.6s ease",
        }}
      >
        {/* ── Header ───────────────────────────────────────────── */}
        <header className="flex items-center justify-between border-b border-border-soft px-5 py-3 sm:px-6">
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
            Vault · live preview
          </span>
          {/* Threshold pill - the count remounts on change so the
              digit pops with a spring. */}
          <motion.span
            key={signedCount}
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", damping: 14, stiffness: 360 }}
            className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2 py-0.5 font-numerals text-[11px] font-semibold tabular-nums text-accent"
          >
            {signedCount}/{VAULT_SHARES.length}
          </motion.span>
        </header>

        <div className="px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex items-center gap-3">
            {/* Vault icon with two staggered pulse rings. The rings
                ride through the icon's ring colour so they pick up
                whatever the theme is currently using. */}
            <span className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-accent/[0.08] text-accent ring-1 ring-accent/20">
              <VaultIcon className="relative h-5 w-5" strokeWidth={1.75} />
              {!reduce && (
                <>
                  <motion.span
                    aria-hidden="true"
                    className="absolute inset-0 rounded-xl"
                    style={{
                      boxShadow:
                        "0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent)",
                    }}
                    animate={{
                      scale: [1, 1.45],
                      opacity: [thresholdMet ? 0.7 : 0.4, 0],
                    }}
                    transition={{
                      duration: thresholdMet ? 1.6 : 2.4,
                      ease: [0.4, 0, 0.6, 1] as const,
                      repeat: Infinity,
                    }}
                  />
                  <motion.span
                    aria-hidden="true"
                    className="absolute inset-0 rounded-xl"
                    style={{
                      boxShadow:
                        "0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent)",
                    }}
                    animate={{
                      scale: [1, 1.45],
                      opacity: [thresholdMet ? 0.7 : 0.4, 0],
                    }}
                    transition={{
                      duration: thresholdMet ? 1.6 : 2.4,
                      ease: [0.4, 0, 0.6, 1] as const,
                      repeat: Infinity,
                      delay: thresholdMet ? 0.8 : 1.2,
                    }}
                  />
                </>
              )}
            </span>
            <div className="leading-tight">
              <p className="font-display text-base font-semibold tracking-[-0.01em] text-text-strong">
                Treasury vault
              </p>
              <p className="mt-0.5 text-[12px] text-text-soft">
                Solana key under quorum
              </p>
            </div>
          </div>

          {/* Threshold progress bar */}
          <div className="mt-5">
            <div className="flex items-baseline justify-between text-[10px] uppercase tracking-[0.18em] text-text-soft">
              <span className="font-mono">Threshold</span>
              <span className="font-numerals tabular-nums text-text-strong">
                {VAULT_THRESHOLD} of {VAULT_SHARES.length}
              </span>
            </div>
            <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-border-soft">
              <motion.div
                className="h-full rounded-full bg-accent"
                initial={{ width: "0%" }}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] as const }}
              />
            </div>
          </div>

          {/* Share holders */}
          <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.18em] text-text-soft">
            Share holders
          </p>
          <ul className="mt-3 divide-y divide-border-soft overflow-hidden rounded-xl border border-border-soft">
            {VAULT_SHARES.map((s, i) => {
              const state = rowState(i);
              const dim = state === "pending";
              return (
                <motion.li
                  key={s.name}
                  animate={{
                    backgroundColor:
                      state === "signing"
                        ? "color-mix(in srgb, var(--accent) 6%, var(--canvas))"
                        : "var(--canvas)",
                  }}
                  transition={{ duration: 0.4 }}
                  className="flex items-center gap-3 px-3.5 py-3"
                >
                  <motion.span
                    animate={{ opacity: dim ? 0.55 : 1 }}
                    transition={{ duration: 0.4 }}
                    className={
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg " +
                      (state === "signed"
                        ? "bg-accent text-text-on-accent"
                        : "border border-border-soft bg-surface-raised text-text-soft")
                    }
                  >
                    {/* Swap icon based on state. AnimatePresence
                        makes the check pop in with a spring when
                        the row flips signed. */}
                    <AnimatePresence mode="wait" initial={false}>
                      {state === "signed" ? (
                        <motion.span
                          key="check"
                          initial={{ scale: 0, rotate: -12 }}
                          animate={{ scale: 1, rotate: 0 }}
                          exit={{ scale: 0 }}
                          transition={{
                            type: "spring",
                            damping: 11,
                            stiffness: 320,
                          }}
                        >
                          <Check className="h-3.5 w-3.5" strokeWidth={3} />
                        </motion.span>
                      ) : (
                        <motion.span
                          key="finger"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.2 }}
                        >
                          <Fingerprint
                            className="h-3.5 w-3.5"
                            strokeWidth={1.75}
                          />
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </motion.span>

                  <motion.span
                    animate={{ opacity: dim ? 0.6 : 1 }}
                    transition={{ duration: 0.4 }}
                    className="flex min-w-0 flex-1 flex-col leading-tight"
                  >
                    <span className="text-[13px] font-semibold text-text-strong">
                      {s.name}
                    </span>
                    <span className="text-[11px] text-text-soft">
                      {s.kind}
                    </span>
                  </motion.span>

                  <div className="flex items-center">
                    <AnimatePresence mode="wait" initial={false}>
                      {state === "pending" && (
                        <motion.span
                          key="pending"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-soft"
                        >
                          waiting
                        </motion.span>
                      )}
                      {state === "signing" && (
                        <motion.span
                          key="signing"
                          initial={{ opacity: 0, x: 4 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -4 }}
                          transition={{ duration: 0.25 }}
                          className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-accent"
                        >
                          signing
                          <span className="inline-flex items-center gap-0.5">
                            <span className="signing-dot h-1 w-1 rounded-full bg-accent" />
                            <span className="signing-dot h-1 w-1 rounded-full bg-accent" />
                            <span className="signing-dot h-1 w-1 rounded-full bg-accent" />
                          </span>
                        </motion.span>
                      )}
                      {state === "signed" && (
                        <motion.span
                          key="signed"
                          initial={{ opacity: 0, x: 4 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.25 }}
                          className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent"
                        >
                          signed
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.li>
              );
            })}
          </ul>

          {/* Recovery-ready celebration - only when threshold met. */}
          <div className="mt-5 h-9">
            <AnimatePresence>
              {thresholdMet && (
                <motion.div
                  key="ready"
                  initial={{ opacity: 0, y: 6, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.96 }}
                  transition={{
                    type: "spring",
                    damping: 16,
                    stiffness: 280,
                  }}
                  className="inline-flex items-center gap-2 rounded-full border border-accent/35 bg-accent/[0.08] px-3 py-1.5"
                >
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-text-on-accent">
                    <Check className="h-2.5 w-2.5" strokeWidth={3.4} />
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
                    Recovery ready
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.article>
    </div>
  );
}

function ConnectCallout() {
  return (
    <section className="rounded-card border border-border-soft bg-surface-raised shadow-card-rest">
      <div className="grid grid-cols-1 gap-5 p-6 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-8 sm:p-8">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
            Sign in to continue
          </p>
          <h2 className="mt-2 font-display text-display-xs leading-tight tracking-[-0.02em] text-text-strong">
            Connect your wallet to see vaults
          </h2>
        </div>
        <Link href="/connect?next=/app/secure" className="inline-block">
          <Button size="lg">
            Sign in
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </Link>
      </div>
    </section>
  );
}

function VaultListSkeleton() {
  return (
    <section>
      <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
        Reading vaults…
      </p>
      <ul className="flex flex-col gap-2">
        {[0, 1].map((i) => (
          <li
            key={i}
            aria-hidden="true"
            className="flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest"
          >
            <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-border-soft" />
            <span className="flex flex-1 flex-col gap-1.5">
              <span className="h-3 w-32 animate-pulse rounded bg-border-soft" />
              <span className="h-2.5 w-48 animate-pulse rounded bg-border-soft" />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ErrorCallout({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <section className="rounded-card border border-warning/40 bg-warning/[0.06] p-4 text-sm text-text-soft sm:p-5">
      <p className="font-medium text-text-strong">
        Couldn&rsquo;t read vaults from devnet.
      </p>
      <p className="mt-1 leading-snug">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex min-h-tap items-center justify-center rounded-full border border-border-soft bg-surface-raised px-4 py-2 text-xs font-medium text-text-soft hover:border-accent hover:text-accent"
      >
        Try again
      </button>
    </section>
  );
}

function VaultCard({ vault }: { vault: DecodedRecovery }) {
  const { connection } = useConnection();
  const { account } = vault;
  const recoveryStr = vault.recovery.toBase58();
  const short = `${recoveryStr.slice(0, 4)}…${recoveryStr.slice(-4)}`;
  const memberCount = account.members.length;
  const proposalCount = account.proposalCount;
  const thresholdPct =
    (Number(account.threshold) / Math.max(memberCount, 1)) * 100;
  const sweepLabel = `${proposalCount} sweep${proposalCount === 1 ? "" : "s"}`;

  // Each card surfaces its dWallet's live SOL balance so the user
  // can pick "the one with funds" at a glance instead of clicking
  // through. The dWallet pubkey is read from localStorage (saved at
  // create time); cards for vaults made on a different device will
  // simply omit the balance, which is fine. The listing still
  // works as a navigation surface.
  const dwalletPubkey = useMemo(() => {
    const att = loadAttestation(recoveryStr);
    if (!att) return null;
    try {
      return new PublicKey(att.publicKey);
    } catch {
      return null;
    }
  }, [recoveryStr]);

  const balanceQ = useQuery({
    queryKey: ["ikavery-vault-balance", dwalletPubkey?.toBase58() ?? "none"],
    queryFn: async () => {
      if (!dwalletPubkey) return null;
      return connection.getBalance(dwalletPubkey, "confirmed");
    },
    enabled: !!dwalletPubkey,
    staleTime: 15_000,
  });
  const balanceSol =
    typeof balanceQ.data === "number"
      ? (balanceQ.data / 1e9).toFixed(2)
      : null;

  // "Needs action" count. Proposals in STATUS_ACTIVE (open for votes)
  // or STATUS_APPROVED (quorum met, awaiting execute). Skips
  // STATUS_EXECUTED (already broadcast). Uses the same cache key the
  // detail page populates so the count matches what the user sees on
  // click-through and is filled instantly when they navigate back.
  const proposalsQ = useQuery({
    queryKey: ["ikavery-proposals", recoveryStr],
    queryFn: () =>
      listProposals(connection, vault.recovery, account.proposalCount),
    enabled: account.proposalCount > 0,
    staleTime: 30_000,
  });
  const pendingCount = useMemo(() => {
    if (!proposalsQ.data) return 0;
    return proposalsQ.data.reduce((acc, p) => {
      if (p.account.status === STATUS_ACTIVE) return acc + 1;
      if (p.account.status === STATUS_APPROVED) return acc + 1;
      return acc;
    }, 0);
  }, [proposalsQ.data]);

  return (
    <li>
      <Link
        href={`/app/secure/${encodeURIComponent(recoveryStr)}`}
        className={
          "group block rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest " +
          "transition-[border-color,transform,box-shadow] duration-base ease-out-soft " +
          "hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-card-raised " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        }
      >
        <div className="flex items-center gap-4">
          <span
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/[0.08] text-accent ring-1 ring-accent/20"
          >
            <VaultIcon className="h-5 w-5" strokeWidth={1.75} />
          </span>

          {/* Identity column - title + monospace short address as a
              dedicated subline. More disciplined than running both
              into one comma-separated string. */}
          <div className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-soft">
              Vault
            </span>
            <span className="mt-1 flex items-center gap-2 truncate">
              <span className="truncate font-display text-base font-semibold tracking-[-0.01em] text-text-strong">
                {short}
              </span>
              {pendingCount > 0 && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-accent/[0.08] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-accent ring-1 ring-accent/30"
                  title={`${pendingCount} proposal${pendingCount === 1 ? "" : "s"} need${pendingCount === 1 ? "s" : ""} action`}
                >
                  <span className="font-numerals tabular-nums">
                    {pendingCount}
                  </span>
                  pending
                </span>
              )}
            </span>
          </div>

          {/* Meta cluster - threshold ratio (focal), member + sweep
              counts beneath as a compact secondary line. Reads as
              a confidence summary without scanning the row. */}
          <div className="hidden min-w-0 flex-col items-end leading-tight sm:flex">
            <span className="font-numerals text-[15px] font-semibold tabular-nums text-text-strong">
              {account.threshold}
              <span className="text-text-soft">/</span>
              {memberCount}
            </span>
            <span className="mt-1 text-[10px] uppercase tracking-[0.16em] text-text-soft">
              {balanceSol != null ? (
                <>
                  <span className="font-numerals tabular-nums normal-case tracking-normal text-text-strong">
                    {balanceSol}
                  </span>
                  {" SOL · "}
                  {sweepLabel}
                </>
              ) : (
                sweepLabel
              )}
            </span>
            {typeof balanceQ.data === "number" && balanceQ.data > 0 && (
              <UsdHint
                amount={BigInt(Math.round(balanceQ.data))}
                smallestPerWhole={1_000_000_000n}
                ticker="SOL"
                variant="plain"
                className="mt-0.5 text-[10px] tabular-nums text-text-soft"
              />
            )}
          </div>

          <ArrowRight
            className="h-4 w-4 shrink-0 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-accent"
            aria-hidden="true"
          />
        </div>

        {/* Mobile-only meta row. Desktop carries the same data via
            the meta cluster above; on mobile we want it inline so
            the row stays compact. */}
        <p className="mt-3 text-[11px] text-text-soft sm:hidden">
          <span className="font-numerals tabular-nums text-text-strong">
            {account.threshold}
          </span>
          {" of "}
          <span className="font-numerals tabular-nums text-text-strong">
            {memberCount}
          </span>
          {" members · "}
          <span className="font-numerals tabular-nums">{proposalCount}</span>
          {" sweep"}
          {proposalCount === 1 ? "" : "s"}
          {balanceSol != null && (
            <>
              {" · "}
              <span className="font-numerals tabular-nums text-text-strong">
                {balanceSol}
              </span>
              {" SOL"}
              {typeof balanceQ.data === "number" && balanceQ.data > 0 && (
                <UsdHint
                  amount={BigInt(Math.round(balanceQ.data))}
                  smallestPerWhole={1_000_000_000n}
                  ticker="SOL"
                />
              )}
            </>
          )}
        </p>

        {/* Threshold confidence bar - subtle, sits below all content.
            Width = threshold/members. The eye reads it as "how much
            of a quorum stands behind this vault" at a glance. */}
        <div className="mt-4 h-[2px] overflow-hidden rounded-full bg-border-soft">
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${thresholdPct}%` }}
          />
        </div>
      </Link>
    </li>
  );
}
