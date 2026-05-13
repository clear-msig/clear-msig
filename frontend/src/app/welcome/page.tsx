"use client";

// Welcome flow - Obsidian & Lime rebuild (2026-05-08).
//
// Visual layer matches the landing page (.landing-shell, glass cards,
// lime accents, Space Grotesk + JetBrains Mono typography). All hooks,
// mutations, and the popup ceremony are unchanged from the prior retail
// version - only paint-and-shape was refactored. See git for the diff.
//
// One ceremony, two popups:
//   popup 1 : createWallet (initial member is just the connected user)
//   popup 2 : propose AddIntent for SolTransfer. The program's
//             auto-approve upgrade lands the proposal Approved on this
//             single signature; execute is sponsored. Falls back to a
//             third popup against an old program via approveIfNeeded.
//
// Friends are intentionally not in this flow. The success screen routes
// the user into the dedicated invite flow once their wallet exists.
//
// Copy rule: zero em dashes. Periods, semicolons, parens, or rephrase.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnection, useWallet } from "@/lib/wallet";
import {
  ArrowRight,
  Check,
  Loader2,
  Send,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useWalletGate } from "@/lib/hooks/useWalletGate";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { backendApi } from "@/lib/api/endpoints";
import { friendlyError } from "@/lib/api/errors";
import { toOnChainName } from "@/lib/retail/walletNames";
import { fetchOnchainMemberships } from "@/lib/memberships/client";
import { encryptPolicyBatch } from "@/lib/encrypt/client";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";

import { useToast } from "@/components/ui/Toast";
import { UnsupportedSignerBanner } from "@/components/retail/UnsupportedSignerBanner";
import { saveWalletAppearance } from "@/lib/retail/walletAppearance";
import { toDisplayName } from "@/lib/retail/walletNames";

import { LandingAtmospherics, LandingNav } from "@/components/landing/LandingChrome";

// 2026-05-08: brief two-card "intro" stage in front of the create
// screen. Skip-able so power-users (and return visits) bypass it;
// persisted via sessionStorage so the tour shows once per tab.
type Stage = "intro" | "create" | "success";

const INTRO_SEEN_KEY = "clear.welcome-intro-seen.v1";

function loadIntroSeen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(INTRO_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markIntroSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(INTRO_SEEN_KEY, "1");
  } catch {
    /* private mode / quota - silently noop */
  }
}

const SOL_TRANSFER_TEMPLATE = "examples/intents/solana_transfer.json";

type ShapeId = "just_me" | "couple" | "family" | "roommates" | "team";

interface WalletShape {
  id: ShapeId;
  label: string;
  blurb: string;
  defaultName: string;
  expectedMembers: number;
}

const SHAPES: WalletShape[] = [
  {
    id: "just_me",
    label: "Just me",
    blurb: "Solo wallet with shared-wallet protections.",
    defaultName: "My wallet",
    expectedMembers: 1,
  },
  {
    id: "couple",
    label: "Me + a partner",
    blurb: "The two of you decide together.",
    defaultName: "Us",
    expectedMembers: 2,
  },
  {
    id: "family",
    label: "Family",
    blurb: "Parents, kids, anyone household.",
    defaultName: "Family",
    expectedMembers: 4,
  },
  {
    id: "roommates",
    label: "Roommates",
    blurb: "Rent, utilities, the group fridge.",
    defaultName: "Roommates",
    expectedMembers: 3,
  },
  {
    id: "team",
    label: "Team",
    blurb: "Co-founders, club, payroll.",
    defaultName: "Team",
    expectedMembers: 5,
  },
];

const TRANSITION = { duration: 0.25, ease: [0.22, 1, 0.36, 1] as const };

export default function WelcomePage() {
  const gate = useWalletGate();
  // signerIssue is set when the connected wallet cannot sign clear-msig's
  // offchain-wrapped messages - Dynamic's WaaS-SVM embedded provider
  // (UTF-8-decodes the bytes before signing) or Phantom (rejects the
  // `\xff` magic prefix as a suspected versioned-tx). Either way, block
  // the Create CTA up front so users don't burn devnet SOL on a
  // createWallet that the second popup will reject.
  const wallet = useWallet();
  const isBrokenSigner = wallet.signerIssue !== null;
  const signerIssue = wallet.signerIssue;
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const reduce = useReducedMotion();
  const { signDescriptor } = useSignWithWallet();
  const { connection } = useConnection();

  const [stage, setStage] = useState<Stage>(() =>
    typeof window !== "undefined" && loadIntroSeen() ? "create" : "intro",
  );
  const [createdSlug, setCreatedSlug] = useState<string | null>(null);
  const [shape, setShape] = useState<ShapeId>("just_me");
  const [name, setName] = useState("");
  /// Cooling-off lives on the wallet's spending rule, not the create
  /// flow. New wallets default to immediate send (0 delay); the
  /// owner can flip it on /app/wallet/[name]/rules later.
  const delaySeconds = 0;

  const currentShape = useMemo(
    () => SHAPES.find((s) => s.id === shape) ?? SHAPES[0],
    [shape],
  );

  const cleanName = useMemo(() => name.trim(), [name]);
  // The on-chain wallet name field is `String<64>`. The frontend
  // appends a 7-byte creator suffix ("#XXXXXX") in toOnChainName so
  // PDAs are unique per (typed-name, creator). Cap the typed name at
  // 57 bytes so the final on-chain name fits the 64-byte limit.
  const nameByteLength = useMemo(
    () => new TextEncoder().encode(cleanName).length,
    [cleanName],
  );
  const nameValid = cleanName.length >= 2 && nameByteLength <= 57;

  // Membership probe. Drives the connection gate: we never render the
  // create flow until this resolves with an empty list. Disabled when
  // disconnected so it does not run with an empty key.
  const memberships = useQuery({
    queryKey: ["my-organizations", gate.publicKey ?? ""],
    queryFn: () => fetchOnchainMemberships(gate.publicKey ?? ""),
    enabled: !!gate.publicKey,
    staleTime: 30_000,
  });

  const setupAll = useMutation({
    mutationFn: async () => {
      if (!gate.publicKey) throw new Error("Connect your wallet first.");
      const me = gate.publicKey;
      const walletSlug = toOnChainName(slug(cleanName), me);
      const initialMembers = [me];
      const threshold = 1;

      // ── popup 1: create wallet ──
      const enc = new TextEncoder();
      const createCt = await encryptPolicyBatch([
        { plaintext: enc.encode(JSON.stringify(initialMembers)), fheType: "ebytes" },
        { plaintext: enc.encode(JSON.stringify(initialMembers)), fheType: "ebytes" },
        { plaintext: new Uint8Array([threshold]), fheType: "euint8" },
      ]);
      const createIds = createCt
        .map((p) => p.ciphertextIdentifier)
        .filter((id): id is string => typeof id === "string");

      await backendApi.createWallet({
        name: walletSlug,
        proposers: initialMembers,
        approvers: initialMembers,
        threshold,
        cancellation_threshold: 1,
        timelock: 0,
        policy_ciphertexts: createIds,
      });

      // ── popup 2: enable sending (propose AddIntent) ──
      const enableCt = await encryptPolicyBatch([
        { plaintext: enc.encode(JSON.stringify(initialMembers)), fheType: "ebytes" },
        { plaintext: enc.encode(JSON.stringify(initialMembers)), fheType: "ebytes" },
        { plaintext: new Uint8Array([threshold]), fheType: "euint8" },
        { plaintext: new Uint8Array([delaySeconds & 0xff]), fheType: "euint32" },
      ]);
      const enableIds = enableCt
        .map((p) => p.ciphertextIdentifier)
        .filter((id): id is string => typeof id === "string");

      const dry = await backendApi.prepare.addIntent(walletSlug, {
        file: SOL_TRANSFER_TEMPLATE,
        proposers: initialMembers,
        approvers: initialMembers,
        threshold,
        cancellation_threshold: 1,
        timelock: delaySeconds,
        policy_ciphertexts: enableIds,
      });
      const signed = await signDescriptor(dry);
      const submitted = await backendApi.submit.addIntent(walletSlug, {
        ...signed,
        params_data_hex: dry.params_data_hex,
        expiry: dry.expiry,
        file: SOL_TRANSFER_TEMPLATE,
      });

      const proposal = (submitted as Record<string, unknown>)?.proposal;
      if (typeof proposal !== "string" || proposal.length === 0) {
        throw new Error(
          "Backend did not return a proposal address from enable-sending.",
        );
      }

      const decision = await approveIfNeeded(connection, proposal);
      if (decision.needsApproveSignature) {
        const approveDry = await backendApi.prepare.approveProposal(
          walletSlug,
          proposal,
          { actor_pubkey: me },
        );
        const approveSigned = await signDescriptor(approveDry);
        await backendApi.submit.approveProposal(walletSlug, proposal, {
          ...approveSigned,
          expiry: approveDry.expiry,
        });
      }
      await backendApi.executeProposal(walletSlug, proposal, {});

      return { walletSlug };
    },
    onSuccess: ({ walletSlug }) => {
      queryClient.invalidateQueries({ queryKey: ["my-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["wallet-intents"] });
      queryClient.invalidateQueries({ queryKey: ["wallet", walletSlug] });
      saveWalletAppearance(cleanName, { shape });
      setCreatedSlug(walletSlug);
      setStage("success");
    },
    onError: (err) => {
      console.error("[welcome] setupAll failed", err);
      const fe = friendlyError(err, "create-wallet");
      toast.error(fe.title, { details: fe.body });
    },
  });

  // ── Connection gate ──────────────────────────────────────────────
  if (!gate.connected) {
    if (gate.loggedInWithoutSolana) {
      return <NeutralWait label="Setting up your Solana wallet." reduce={!!reduce} />;
    }
    return <NeutralWait label="Taking you to connect a wallet." reduce={!!reduce} />;
  }
  if (memberships.isLoading) {
    return <NeutralWait label="Checking your wallets." reduce={!!reduce} />;
  }

  const pageMotion = reduce
    ? { initial: false, animate: { opacity: 1 }, exit: { opacity: 1 } }
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -12 },
      };

  return (
    <div className="landing-shell relative min-h-screen bg-[#0c0c0c] text-[#ebebeb]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <LandingAtmospherics />
      </div>
      <LandingNav />
      <main className="relative mx-auto w-full max-w-[1600px]">
        <div className="relative z-10 flex min-h-[calc(100vh-9rem)] items-center justify-center px-5 pb-10 pt-3 sm:min-h-[calc(100vh-12rem)] sm:px-10 sm:pb-28 sm:pt-6 lg:pb-32">
          <div className="flex w-full max-w-lg flex-col gap-3.5 sm:gap-4">
            <UnsupportedSignerBanner
              title="You won't be able to finish creating a wallet with this sign-in"
            />

            {/* Returning users: surface a way back to existing wallets. */}
            {!memberships.isLoading &&
              (memberships.data?.length ?? 0) > 0 && (
                <Link
                  href={
                    memberships.data && memberships.data.length === 1
                      ? `/app/wallet/${encodeURIComponent(
                          memberships.data[0].wallet_name ?? "",
                        )}`
                      : "/app/wallet"
                  }
                  className="group flex items-center gap-3 rounded-2xl border border-[#ccff00]/40 bg-[#ccff00]/[0.06] p-3.5 backdrop-blur-md transition-all duration-300 hover:border-[#ccff00] hover:bg-[#ccff00]/10 sm:p-4"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#ccff00]/15 text-[#ccff00] ring-1 ring-[#ccff00]/40">
                    <Users className="h-5 w-5" strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono-tech text-[10px] uppercase tracking-[0.28em] text-[#ccff00]">
                      {memberships.data!.length === 1
                        ? "You already have a wallet"
                        : `You're in ${memberships.data!.length} wallets`}
                    </p>
                    <p className="mt-1 truncate text-sm font-medium text-white">
                      {memberships.data!.length === 1
                        ? `Continue with ${toDisplayName(memberships.data![0].wallet_name ?? "Wallet")}`
                        : "Open the wallet hub"}
                    </p>
                  </div>
                  <ArrowRight
                    className="h-4 w-4 shrink-0 text-[#ccff00] transition-transform duration-200 group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </Link>
              )}

            <AnimatePresence mode="wait" initial={false}>
              {stage === "intro" && (
                <motion.section
                  key="intro"
                  {...pageMotion}
                  transition={TRANSITION}
                  className="flex flex-col"
                >
                  <div className="flex items-center gap-2">
                    <span className="lime-dot h-1.5 w-1.5 rounded-full bg-[#ccff00] shadow-[0_0_8px_#ccff00]" />
                    <span className="font-mono-tech text-[10px] uppercase tracking-[0.28em] text-white/60 sm:tracking-[0.32em]">
                      Welcome to Clear
                    </span>
                  </div>

                  <h2 className="mt-4 text-[clamp(1.75rem,8vw,3rem)] font-light leading-[0.95] tracking-[-0.04em] text-white text-balance sm:mt-5">
                    A shared wallet for
                    <br />
                    people you <span className="italic-skew">trust</span>.
                  </h2>
                  <p className="mt-3 max-w-md text-[15px] leading-relaxed text-white/60 sm:mt-4 sm:text-base">
                    Two things to know before you build one.
                  </p>

                  <div className="mt-6 flex flex-col gap-3 sm:mt-8">
                    <article className="glass rounded-2xl p-4 transition-colors duration-300 hover:border-[#ccff00]/40 sm:p-5">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#ccff00]/10 text-[#ccff00] ring-1 ring-[#ccff00]/30">
                          <Users className="h-5 w-5" strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <p className="text-base font-medium text-white">
                              Approve from anywhere
                            </p>
                            <span className="font-mono-tech text-[9px] uppercase tracking-[0.24em] text-white/40">
                              /policy
                            </span>
                          </div>
                          <p className="mt-1.5 text-sm leading-relaxed text-white/60">
                            Anyone you add can read every request and tap
                            Approve from their phone or browser. Your phone
                            is the second factor. No keys to lose.
                          </p>
                        </div>
                      </div>
                    </article>
                    <article className="glass rounded-2xl p-4 transition-colors duration-300 hover:border-[#ccff00]/40 sm:p-5">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#ccff00]/10 text-[#ccff00] ring-1 ring-[#ccff00]/30">
                          <Send className="h-5 w-5" strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <p className="text-base font-medium text-white">
                              One wallet, every chain
                            </p>
                            <span className="font-mono-tech text-[9px] uppercase tracking-[0.24em] text-white/40">
                              /chains
                            </span>
                          </div>
                          <p className="mt-1.5 text-sm leading-relaxed text-white/60">
                            The same shared wallet sends Solana, Ethereum,
                            Bitcoin, and Zcash. One signature ceremony, one
                            source of truth, no bridges.
                          </p>
                        </div>
                      </div>
                    </article>
                  </div>

                  <div className="mt-6 flex items-center justify-between gap-3 sm:mt-8">
                    <button
                      type="button"
                      onClick={() => {
                        markIntroSeen();
                        setStage("create");
                      }}
                      className="-mx-2 -my-2 rounded-full px-3 py-2 font-mono-tech text-[11px] uppercase tracking-[0.24em] text-white/50 transition-colors duration-200 hover:text-white"
                    >
                      Skip intro
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        markIntroSeen();
                        setStage("create");
                      }}
                      className="neon-cta inline-flex min-w-[8.5rem] items-center justify-center gap-2 rounded-full px-6 py-3.5 text-[14px] font-bold tracking-tight sm:min-w-[10rem] sm:px-7"
                    >
                      Continue
                      <ArrowRight className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
                    </button>
                  </div>

                  {/* Unified-product secondary path. The Secure shape
                      is the other thing this engine supports — same
                      Ika dWallet substrate, simpler enrollment flow.
                      Surfaced as a low-emphasis link so the primary
                      "shared wallet" flow stays the loud thing on
                      this page, but visitors who came here looking
                      to secure a personal key aren't dead-ended.
                      See Fesal feedback 2026-05-11. */}
                  <Link
                    href="/app/secure/new"
                    className="mt-6 inline-flex items-center gap-1.5 self-start font-mono-tech text-[11px] uppercase tracking-[0.24em] text-white/40 transition-colors duration-200 hover:text-white/80"
                  >
                    Or secure your own key →
                  </Link>
                </motion.section>
              )}

              {stage === "create" && (
                <motion.section
                  key="create"
                  {...pageMotion}
                  transition={TRANSITION}
                  className="flex flex-col"
                >
                  <div className="flex items-center gap-2">
                    <span className="lime-dot h-1.5 w-1.5 rounded-full bg-[#ccff00] shadow-[0_0_8px_#ccff00]" />
                    <span className="font-mono-tech text-[10px] uppercase tracking-[0.24em] text-white/60 sm:tracking-[0.32em]">
                      /create · shared wallet
                    </span>
                  </div>

                  <h2 className="mt-4 text-[clamp(1.75rem,8vw,3rem)] font-light leading-[0.95] tracking-[-0.04em] text-white text-balance sm:mt-5">
                    Create your
                    <br />
                    shared <span className="italic-skew">wallet</span>.
                  </h2>
                  <p className="mt-3 max-w-md text-[15px] leading-relaxed text-white/60 sm:mt-4 sm:text-base">
                    Name it, pick who it's for. You can invite friends after.
                  </p>

                  {/* Name input */}
                  <div className="mt-6 sm:mt-8">
                    <label
                      htmlFor="wallet-name"
                      className="font-mono-tech text-[10px] uppercase tracking-[0.28em] text-white/60"
                    >
                      Name it
                    </label>
                    <div className="mt-3 flex items-stretch gap-3">
                      <span
                        aria-hidden="true"
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#ccff00]/10 text-lg font-semibold text-[#ccff00] ring-1 ring-[#ccff00]/30"
                      >
                        {cleanName.charAt(0).toUpperCase() || "?"}
                      </span>
                      <input
                        id="wallet-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={currentShape.defaultName}
                        maxLength={57}
                        autoFocus
                        className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-3 text-base text-white outline-none backdrop-blur-md transition-[border-color,box-shadow] duration-200 placeholder:text-white/30 focus:border-[#ccff00]/60 focus:shadow-[0_0_0_3px_rgba(204, 255, 0,0.15)] sm:px-4"
                      />
                    </div>
                  </div>

                  {/* Shape chips */}
                  <div className="mt-5 sm:mt-6">
                    <p className="font-mono-tech text-[10px] uppercase tracking-[0.28em] text-white/60">
                      Who's it for?
                    </p>
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {SHAPES.map((s) => {
                        const selected = shape === s.id;
                        return (
                          <li key={s.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setShape(s.id);
                                if (!name.trim()) setName(s.defaultName);
                              }}
                              aria-pressed={selected}
                              className={
                                "rounded-full border px-3.5 py-2 text-xs font-medium backdrop-blur-md transition-all duration-200 sm:py-1.5 " +
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ccff00]/50 " +
                                (selected
                                  ? "border-[#ccff00] bg-[#ccff00]/10 text-[#ccff00] shadow-[0_0_18px_rgba(204, 255, 0,0.18)]"
                                  : "border-white/10 bg-white/[0.03] text-white/60 hover:border-white/30 hover:text-white")
                              }
                            >
                              {s.label}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  {/* What happens next callout */}
                  <div className="glass mt-5 rounded-2xl p-4 sm:mt-6">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-3.5 w-3.5 text-[#ccff00]" strokeWidth={2} />
                      <span className="font-mono-tech text-[10px] uppercase tracking-[0.28em] text-white/60">
                        / what happens next
                      </span>
                    </div>
                    <p className="mt-2.5 text-[13.5px] leading-relaxed text-white/70">
                      Your wallet will pop up to{" "}
                      <span className="font-medium text-white">
                        create the wallet
                      </span>{" "}
                      and set up sending in the same step. The signing text
                      looks technical - that's normal. Nothing leaves your
                      account.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setupAll.mutate()}
                    disabled={!nameValid || setupAll.isPending || isBrokenSigner}
                    className="neon-cta mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-4 text-[14px] font-bold tracking-tight disabled:cursor-not-allowed disabled:opacity-50 sm:mt-7 sm:px-7"
                  >
                    {setupAll.isPending ? (
                      <>
                        <Loader2
                          className="h-4 w-4 animate-spin"
                          aria-hidden="true"
                        />
                        Setting up
                      </>
                    ) : isBrokenSigner ? (
                      <span className="truncate">Sign in with a different wallet</span>
                    ) : (
                      <>
                        <span className="truncate">
                          Create {cleanName || currentShape.defaultName}
                        </span>
                        <ArrowRight
                          className="h-4 w-4 shrink-0"
                          strokeWidth={2.5}
                          aria-hidden="true"
                        />
                      </>
                    )}
                  </button>
                  {isBrokenSigner && (
                    <p className="mt-3 text-center font-mono-tech text-[10px] uppercase tracking-[0.24em] text-white/50">
                      Email/Google sign-in can't sign Solana yet. Use{" "}
                      <span className="text-[#ccff00]">Solflare</span>, Backpack,
                      or a Ledger.
                    </p>
                  )}
                </motion.section>
              )}

              {stage === "success" && (
                <motion.section
                  key="success"
                  {...pageMotion}
                  transition={{ ...TRANSITION, duration: 0.3 }}
                  className="flex flex-col items-center text-center"
                >
                  <motion.div
                    initial={reduce ? false : { scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{
                      type: "spring",
                      damping: 18,
                      stiffness: 220,
                      delay: 0.05,
                    }}
                    className="mb-5 flex h-[72px] w-[72px] items-center justify-center rounded-full bg-[#ccff00] text-black shadow-[0_0_48px_rgba(204, 255, 0,0.55)] sm:mb-6 sm:h-20 sm:w-20"
                  >
                    <Check className="h-9 w-9 sm:h-10 sm:w-10" strokeWidth={2.5} />
                  </motion.div>
                  <div className="flex items-center gap-2">
                    <span className="lime-dot h-1.5 w-1.5 rounded-full bg-[#ccff00]" />
                    <span className="font-mono-tech text-[10px] uppercase tracking-[0.24em] text-white/60 sm:tracking-[0.28em]">
                      / wallet ready
                    </span>
                  </div>
                  <h2 className="mt-3 text-[clamp(1.75rem,8vw,3rem)] font-light leading-[0.95] tracking-[-0.04em] text-white text-balance sm:mt-4">
                    {cleanName} is{" "}
                    <span className="italic-skew">ready</span>.
                  </h2>
                  <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-white/60 sm:mt-4 sm:text-base">
                    {currentShape.expectedMembers > 1
                      ? `Send your first request, or invite the other ${
                          currentShape.expectedMembers - 1
                        } so they can approve with you.`
                      : "Pick someone, pick an amount. We will do the rest."}
                  </p>
                  <div className="mt-7 flex w-full max-w-sm flex-col gap-3 sm:mt-10">
                    <button
                      type="button"
                      onClick={() =>
                        router.push(
                          `/app/wallet/${encodeURIComponent(createdSlug ?? slug(cleanName))}/send`,
                        )
                      }
                      className="neon-cta inline-flex w-full items-center justify-center gap-2 rounded-full px-7 py-4 text-[14px] font-bold tracking-tight"
                    >
                      Send your first request
                      <Send className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
                    </button>
                    {currentShape.expectedMembers > 1 && (
                      <Link
                        href={`/app/wallet/${encodeURIComponent(createdSlug ?? slug(cleanName))}/members/add`}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.03] px-6 py-3.5 text-[13px] font-medium text-white/80 backdrop-blur-md transition-colors duration-200 hover:border-white/40 hover:text-white"
                      >
                        Invite a {inviteNoun(currentShape.id)}
                      </Link>
                    )}
                    <Link
                      href={`/app/wallet/${encodeURIComponent(createdSlug ?? slug(cleanName))}`}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-2.5 font-mono-tech text-[11px] uppercase tracking-[0.24em] text-white/50 transition-colors duration-200 hover:text-white"
                    >
                      Open {cleanName}
                    </Link>
                  </div>
                </motion.section>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>
    </div>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────

/// Neutral holding state used by every pre-wizard branch (disconnected,
/// memberships loading). Wears the same Obsidian & Lime chrome so the
/// page never flashes a different design language while resolving.
function NeutralWait({ label, reduce }: { label: string; reduce: boolean }) {
  return (
    // Nav is intentionally omitted while wallets/memberships resolve.
    // No actionable links exist for the user during this state, so
    // the chrome would just be noise around the spinner.
    <div className="landing-shell relative min-h-screen bg-[#0c0c0c] text-[#ebebeb]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <LandingAtmospherics />
      </div>
      <main className="relative mx-auto w-full max-w-[1600px]">
        <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col items-center text-center"
          >
            <div className="glass flex h-16 w-16 items-center justify-center rounded-full">
              <Loader2
                className="h-7 w-7 animate-spin text-[#ccff00]"
                aria-hidden="true"
              />
            </div>
            <p className="mt-5 font-mono-tech text-[11px] uppercase tracking-[0.28em] text-white/70">
              {label}
            </p>
          </motion.div>
        </div>
      </main>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

/// Friendly noun for the success-screen invite CTA, derived from shape.
function inviteNoun(id: ShapeId): string {
  if (id === "team") return "teammate";
  if (id === "couple") return "partner";
  if (id === "family") return "family member";
  if (id === "roommates") return "roommate";
  return "friend";
}

/// Wallet names go on chain and the backend allows only [a-zA-Z0-9_-].
/// Pass the user's typed name through cleanly - only trim whitespace
/// and clamp to the on-chain 64-byte limit.
function slug(s: string): string {
  const trimmed = s.trim();
  if (!trimmed) return "wallet";
  // 64 BYTES, not 64 chars - emoji are 4 bytes each in UTF-8.
  const enc = new TextEncoder();
  const bytes = enc.encode(trimmed);
  if (bytes.length <= 64) return trimmed;
  // Truncate by bytes without splitting a multi-byte codepoint.
  const truncated = enc.encode(trimmed).subarray(0, 64);
  return new TextDecoder("utf-8", { fatal: false }).decode(truncated);
}
