"use client";

// Welcome flow. Three-stage wizard that takes a connected user from
// "I clicked Get started" to "my shared wallet is on chain and can
// send money" with exactly two wallet popups.
//
// Stage map:
//   1. shape_name : pick the shape preset, name it, optional color
//   2. pace       : send-immediately or 24-hour cooling-off
//   3. confirm    : preview card, honest popup narration, Create CTA
//   success      : Send your first request / Open the wallet
//
// One ceremony, two popups:
//   popup 1 : createWallet (initial member is just the connected user)
//   popup 2 : propose AddIntent for SolTransfer. The program's
//             auto-approve upgrade lands the proposal Approved on this
//             single signature; execute is sponsored. Falls back to a
//             third popup against an old program via approveIfNeeded.
//
// Friends are intentionally not in this flow. The success screen
// routes the user into the dedicated invite flow once their wallet
// exists. That avoids the "looks done but isn't" trap of inviting by
// email here, since email-only invites still require a follow-up
// chain mutation when the friend accepts.
//
// Connection gate: this page never renders the create CTA before we
// have proof that (a) the user is connected and (b) they have no
// existing wallets. The disconnected and loading paths render neutral
// holding states; useWalletGate handles the redirect to /connect.
//
// Copy rule: zero em dashes. Periods, semicolons, parens, or rephrase.
//
// Performance budget: 70fps+. Compositor-only animations, no
// backdrop-blur, no per-row framer trees.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnection } from "@/lib/wallet";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Send,
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
import { Button } from "@/components/retail/Button";
import { BrandLoader } from "@/components/retail/BrandLoader";
import { StickyTopBar } from "@/components/retail/StickyTopBar";
import { WaasLimitationBanner } from "@/components/retail/WaasLimitationBanner";
import { saveWalletAppearance } from "@/lib/retail/walletAppearance";

// Welcome was a 3-stage wizard (shape_name → pace → confirm). Honest
// review (2026-05-03): the pace choice never moved a user; the
// confirm stage was the third instance of the same preview card.
// Collapsed to a single create screen + a success payoff. Cooling-off
// and color customization moved to the wallet's spending rules where
// they're load-bearing rather than ceremonial.
type Stage = "create" | "success";

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
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const reduce = useReducedMotion();
  const { signDescriptor } = useSignWithWallet();
  const { connection } = useConnection();

  const [stage, setStage] = useState<Stage>("create");
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
  // 57 bytes so the final on-chain name fits the 64-byte limit. JS
  // `.length` counts UTF-16 code units, not UTF-8 bytes — the byte
  // count is what the program enforces.
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
      // The on-chain program derives the wallet PDA from the name
      // alone, so two users picking the same display name would
      // collide. Suffix the slug with the creator's pubkey so the
      // PDA stays unique per (name, creator). The display layer
      // strips the suffix in toDisplayName(). The proper fix
      // (creator-scoped PDA seeds in the program) is in Plan B.
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
      // The program's auto-approve upgrade lands this Approved on the
      // single propose signature; execute below is sponsored. Old
      // program falls back through approveIfNeeded to a third popup.
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
      // Color picker moved out of the create flow. Wallet appearance
      // gets derived from the name hash at render time; the user can
      // pick a real color from the wallet's settings later.
      saveWalletAppearance(cleanName, { shape });
      setStage("success");
    },
    onError: (err) => {
      console.error("[welcome] setupAll failed", err);
      const fe = friendlyError(err, "create-wallet");
      toast.error(fe.title, { details: fe.body });
    },
  });

  // ── Connection gate ──────────────────────────────────────────────
  // Three holding states render before the wizard is allowed to
  // appear. None of them show the create CTA.
  //   1. Disconnected: useWalletGate is already routing to /connect;
  //      we render a neutral wait state so nothing flashes.
  //   2. Connected, memberships loading: brand loader.
  //   3. Connected, memberships found: redirect to /app/wallet.
  if (!gate.connected) {
    // Distinguish "not signed in" from "signed in via Dynamic but no
    // Solana wallet minted yet." Otherwise the user sees "taking you
    // to connect" while sitting on a connected session.
    if (gate.loggedInWithoutSolana) {
      return (
        <NeutralWait
          label="Setting up your Solana wallet."
          reduce={!!reduce}
        />
      );
    }
    return <NeutralWait label="Taking you to connect a wallet." reduce={!!reduce} />;
  }
  if (memberships.isLoading) {
    return <NeutralWait label="Checking your wallets." reduce={!!reduce} />;
  }
  // (Returning users explicitly clicking "+ New shared wallet" land
  // here on purpose. The auto-redirect that used to fire on any
  // memberships > 0 was bouncing them back to the dashboard before
  // they could create a second wallet. /connect's gate already
  // routes returning users home when they sign in fresh, so the
  // duplicate guard here was always a safety belt for an edge case
  // that doesn't justify breaking the second-wallet path.)

  const pageMotion = reduce
    ? { initial: false, animate: { opacity: 1 }, exit: { opacity: 1 } }
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -12 },
      };

  // Single-screen create flow — no in-page back affordance needed.
  // The StickyTopBar always renders the home link.

  return (
    <main className="relative flex min-h-screen flex-col bg-canvas">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -left-32 -top-16 h-[55vh] w-[80vw] max-w-[640px] rounded-full bg-accent/[0.07] blur-3xl" />
      </div>

      <StickyTopBar>
        <Link
          href="/"
          className={
            "-ml-2 inline-flex items-center gap-1.5 rounded-soft px-2 py-1 text-sm text-text-soft " +
            "transition-colors duration-base ease-out-soft hover:text-text-strong " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          }
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Clear
        </Link>
      </StickyTopBar>

      <div className="relative z-10 flex flex-1 items-center justify-center px-gutter pb-16 pt-8">
        <div className="flex w-full max-w-md flex-col gap-4">
          <WaasLimitationBanner
            title="You won't be able to finish creating a wallet with this sign-in"
          />
          <AnimatePresence mode="wait" initial={false}>
            {stage === "create" && (
              <motion.section
                key="create"
                {...pageMotion}
                transition={TRANSITION}
                className="flex flex-col"
              >
                <div className="text-center">
                  <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-full bg-accent/10">
                    <Users className="h-7 w-7 text-accent" strokeWidth={1.75} />
                  </div>
                  <h2 className="font-display text-display-sm text-text-strong text-balance">
                    Create your shared wallet
                  </h2>
                  <p className="mt-2 text-base text-text-soft">
                    Name it, pick who it's for. You can invite friends after.
                  </p>
                </div>

                {/* Name input first — that's the only field with real
                    free-form work. Avatar derives from the typed name
                    + selected shape; no color picker. (Color moved to
                    /app/wallet/[name]/rules where it can live with
                    the rest of the wallet's settings.) */}
                <div className="mt-8">
                  <label
                    htmlFor="wallet-name"
                    className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft"
                  >
                    Name it
                  </label>
                  <div className="mt-2 flex items-stretch gap-3">
                    <span
                      aria-hidden="true"
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent/15 text-lg font-semibold text-accent shadow-card-rest"
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
                      className={
                        "min-w-0 flex-1 rounded-card border border-border-soft bg-surface-raised " +
                        "px-4 py-3 text-base text-text-strong placeholder:text-text-soft " +
                        "outline-none transition-[border-color,box-shadow] duration-base ease-out-soft " +
                        "focus:border-accent focus:shadow-accent-rest"
                      }
                    />
                  </div>
                </div>

                {/* Shape: tighter chip row instead of the old big-tile
                    grid. The choice still informs default name + invite
                    copy, but visually it stays out of the way of the
                    actual decisions (name + create). */}
                <div className="mt-6">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
                    Who's it for?
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
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
                              "rounded-full border px-3 py-1.5 text-xs font-medium " +
                              "transition-[border-color,background-color,color] duration-base ease-out-soft " +
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas " +
                              (selected
                                ? "border-accent bg-accent/10 text-accent"
                                : "border-border-soft bg-surface-raised text-text-soft hover:border-accent/40 hover:text-text-strong")
                            }
                          >
                            {s.label}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {/* Honest popup narration. Solana signMessage shows
                    hex bytes, not a friendly summary; we surface that
                    fact up front so users don't think their wallet is
                    broken. Compact form (was a full-width card on the
                    old confirm screen). */}
                <div className="mt-6 rounded-card border border-border-soft bg-surface-raised p-4 text-left text-sm shadow-card-rest">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
                    What happens next
                  </p>
                  <p className="mt-2 text-text-strong">
                    Two wallet popups: one to{" "}
                    <span className="font-medium">create the wallet</span>,
                    one to <span className="font-medium">enable sending</span>.
                    Each shows technical-looking signing text — that's
                    normal. Nothing leaves your account.
                  </p>
                </div>

                <Button
                  size="lg"
                  fullWidth
                  className="mt-6"
                  onClick={() => setupAll.mutate()}
                  disabled={!nameValid || setupAll.isPending}
                >
                  {setupAll.isPending ? (
                    <>
                      <Loader2
                        className="h-4 w-4 animate-spin"
                        aria-hidden="true"
                      />
                      Setting up
                    </>
                  ) : (
                    <>
                      Create {cleanName || currentShape.defaultName}
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </>
                  )}
                </Button>
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
                  className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-accent text-white shadow-accent-rest"
                >
                  <Check className="h-10 w-10" strokeWidth={2.5} />
                </motion.div>
                <h2 className="font-display text-display-md leading-[1.0] text-text-strong">
                  {cleanName} is ready
                </h2>
                <p className="mt-3 max-w-sm text-base text-text-soft">
                  {currentShape.expectedMembers > 1
                    ? `Send your first request, or invite the other ${
                        currentShape.expectedMembers - 1
                      } so they can approve with you.`
                    : "Pick someone, pick an amount. We will do the rest."}
                </p>
                <div className="mt-8 flex w-full max-w-sm flex-col gap-3">
                  <Button
                    size="lg"
                    fullWidth
                    onClick={() =>
                      router.push(
                        `/app/wallet/${encodeURIComponent(slug(cleanName))}/send`,
                      )
                    }
                  >
                    Send your first request
                    <Send className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  {currentShape.expectedMembers > 1 && (
                    <Link
                      href={`/app/wallet/${encodeURIComponent(slug(cleanName))}/members/add`}
                      className={
                        "inline-flex w-full items-center justify-center gap-1.5 rounded-card border border-border-soft " +
                        "bg-surface-raised px-4 py-2.5 text-sm font-medium text-text-strong shadow-card-rest " +
                        "transition-[border-color,transform] duration-base ease-out-soft " +
                        "hover:-translate-y-0.5 hover:border-accent " +
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                      }
                    >
                      Invite a {inviteNoun(currentShape.id)}
                    </Link>
                  )}
                  <Link
                    href={`/app/wallet/${encodeURIComponent(slug(cleanName))}`}
                    className={
                      "inline-flex w-full items-center justify-center gap-1.5 rounded-soft px-4 py-2 " +
                      "text-sm font-medium text-text-soft " +
                      "transition-colors duration-base ease-out-soft hover:text-text-strong " +
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                    }
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
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────

/// Neutral holding state used by every pre-wizard branch (disconnected,
/// memberships loading). Keeps the create CTA off-screen until we have
/// proof the user needs it.
function NeutralWait({ label, reduce }: { label: string; reduce: boolean }) {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-canvas px-gutter">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -left-32 -top-16 h-[55vh] w-[80vw] max-w-[640px] rounded-full bg-accent/[0.06] blur-3xl" />
      </div>
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="relative z-10 flex flex-col items-center text-center"
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-raised shadow-card-rest">
          <BrandLoader size={32} label={label} />
        </div>
        <p className="mt-5 font-display text-base text-text-strong">{label}</p>
      </motion.div>
    </main>
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
/// Pass the user's typed name through cleanly — only trim whitespace
/// and clamp to the on-chain 64-byte limit. Earlier versions
/// lowercased + dashed every non-alnum character, but that meant
/// "Soccer Trip" became "soccer-trip" on chain (and visible to other
/// members), which is hostile to retail. The backend allows any
/// non-control UTF-8 within 64 bytes, so we let the typed name flow
/// through.
function slug(s: string): string {
  const trimmed = s.trim();
  if (!trimmed) return "wallet";
  // 64 BYTES, not 64 chars — emoji are 4 bytes each in UTF-8.
  const enc = new TextEncoder();
  const bytes = enc.encode(trimmed);
  if (bytes.length <= 64) return trimmed;
  // Truncate by bytes without splitting a multi-byte codepoint.
  const truncated = enc.encode(trimmed).subarray(0, 64);
  return new TextDecoder("utf-8", { fatal: false }).decode(truncated);
}
