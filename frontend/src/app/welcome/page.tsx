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
  Clock,
  Loader2,
  Send,
  Users,
  Zap,
} from "lucide-react";
import { useWalletGate } from "@/lib/hooks/useWalletGate";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { backendApi } from "@/lib/api/endpoints";
import { friendlyError } from "@/lib/api/errors";
import { fetchOnchainMemberships } from "@/lib/memberships/client";
import { encryptPolicyBatch } from "@/lib/encrypt/client";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import { fromHex } from "@/lib/msig";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/retail/Button";
import { BrandLoader } from "@/components/retail/BrandLoader";
import { StickyTopBar } from "@/components/retail/StickyTopBar";
import {
  COLOR_PALETTE,
  saveWalletAppearance,
} from "@/lib/retail/walletAppearance";

type Stage = "shape_name" | "pace" | "confirm" | "success";
const WIZARD_STAGES: Stage[] = ["shape_name", "pace", "confirm"];

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
  const { signBytes } = useSignWithWallet();
  const { connection } = useConnection();

  const [stage, setStage] = useState<Stage>("shape_name");
  const [shape, setShape] = useState<ShapeId>("just_me");
  const [name, setName] = useState("");
  const [pickedColor, setPickedColor] = useState<string | null>(null);
  /// 0 ships immediately when approvals land. 86400 is a 24-hour
  /// cooling-off period before the send goes out.
  const [delaySeconds, setDelaySeconds] = useState<number>(0);

  const currentShape = useMemo(
    () => SHAPES.find((s) => s.id === shape) ?? SHAPES[0],
    [shape],
  );

  const cleanName = useMemo(() => name.trim(), [name]);
  // The on-chain wallet name field is `String<64>`. JS `.length` counts
  // code units, not UTF-8 bytes; guard the encoded byte length so emoji
  // and accented names cannot silently overflow.
  const nameByteLength = useMemo(
    () => new TextEncoder().encode(cleanName).length,
    [cleanName],
  );
  const nameValid = cleanName.length >= 2 && nameByteLength <= 64;

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
      const walletSlug = slug(cleanName);
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
      const signed = await signBytes(fromHex(dry.message_hex));
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
        const approveSigned = await signBytes(fromHex(approveDry.message_hex));
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
      saveWalletAppearance(cleanName, {
        shape,
        color: pickedColor ?? undefined,
      });
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
    return <NeutralWait label="Taking you to connect a wallet." reduce={!!reduce} />;
  }
  if (memberships.isLoading) {
    return <NeutralWait label="Checking your wallets." reduce={!!reduce} />;
  }
  if ((memberships.data?.length ?? 0) > 0 && stage !== "success") {
    router.replace("/app/wallet");
    return <NeutralWait label="You already have a wallet. Taking you home." reduce={!!reduce} />;
  }

  const pageMotion = reduce
    ? { initial: false, animate: { opacity: 1 }, exit: { opacity: 1 } }
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -12 },
      };

  const stageIdx = WIZARD_STAGES.indexOf(stage as Stage);

  function goBack() {
    if (stage === "pace") setStage("shape_name");
    else if (stage === "confirm") setStage("pace");
  }

  return (
    <main className="relative flex min-h-screen flex-col bg-canvas">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -left-32 -top-16 h-[55vh] w-[80vw] max-w-[640px] rounded-full bg-accent/[0.07] blur-3xl" />
      </div>

      <StickyTopBar>
        {stage === "shape_name" || stage === "success" ? (
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
        ) : (
          <button
            type="button"
            onClick={goBack}
            disabled={setupAll.isPending}
            className={
              "-ml-2 inline-flex items-center gap-1.5 rounded-soft px-2 py-1 text-sm text-text-soft " +
              "transition-colors duration-base ease-out-soft hover:text-text-strong disabled:opacity-50 " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            }
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </button>
        )}
      </StickyTopBar>

      {/* Progress dots. Only on wizard stages so the success screen
          reads as payoff, not "step 4 of 3". */}
      {stage !== "success" && (
        <div
          aria-hidden="true"
          className="relative z-10 flex items-center justify-center gap-2 px-gutter pt-6"
        >
          {WIZARD_STAGES.map((s, i) => {
            const reached = stageIdx >= i;
            return (
              <span
                key={s}
                className={
                  "h-1.5 w-8 rounded-full transition-colors duration-base ease-out-soft " +
                  (reached ? "bg-accent" : "bg-border-soft")
                }
              />
            );
          })}
        </div>
      )}

      <div className="relative z-10 flex flex-1 items-center justify-center px-gutter pb-16 pt-8">
        <div className="w-full max-w-md">
          <AnimatePresence mode="wait" initial={false}>
            {stage === "shape_name" && (
              <motion.section
                key="shape_name"
                {...pageMotion}
                transition={TRANSITION}
                className="flex flex-col"
              >
                <div className="text-center">
                  <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-full bg-accent/10">
                    <Users className="h-7 w-7 text-accent" strokeWidth={1.75} />
                  </div>
                  <h2 className="font-display text-display-sm text-text-strong text-balance">
                    Who is this wallet for?
                  </h2>
                  <p className="mt-2 text-base text-text-soft">
                    Pick the shape, give it a name. We will tailor the rest.
                  </p>
                </div>

                <ul className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-3">
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
                            "flex h-full w-full flex-col items-start gap-1 rounded-card border p-3 text-left " +
                            "transition-[border-color,background-color,transform,box-shadow] duration-base ease-out-soft " +
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas " +
                            (selected
                              ? "border-accent bg-accent/5 shadow-card-rest"
                              : "border-border-soft bg-surface-raised hover:border-accent/40 hover:-translate-y-px")
                          }
                        >
                          <span
                            className={
                              "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold " +
                              (selected
                                ? "bg-accent text-white"
                                : "bg-canvas text-text-soft")
                            }
                          >
                            {s.expectedMembers}
                          </span>
                          <p className="mt-1 text-sm font-medium text-text-strong">
                            {s.label}
                          </p>
                          <p className="text-[11px] leading-snug text-text-soft">
                            {s.blurb}
                          </p>
                        </button>
                      </li>
                    );
                  })}
                </ul>

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
                      className={
                        "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br " +
                        "text-lg font-semibold text-white shadow-card-rest " +
                        ((pickedColor
                          ? COLOR_PALETTE.find((p) => p.id === pickedColor)
                          : COLOR_PALETTE[0])?.from ?? "") +
                        " " +
                        ((pickedColor
                          ? COLOR_PALETTE.find((p) => p.id === pickedColor)
                          : COLOR_PALETTE[0])?.to ?? "")
                      }
                    >
                      {cleanName.charAt(0).toUpperCase() || "?"}
                    </span>
                    <input
                      id="wallet-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={currentShape.defaultName}
                      maxLength={64}
                      className={
                        "min-w-0 flex-1 rounded-card border border-border-soft bg-surface-raised " +
                        "px-4 py-3 text-base text-text-strong placeholder:text-text-soft " +
                        "outline-none transition-[border-color,box-shadow] duration-base ease-out-soft " +
                        "focus:border-accent focus:shadow-accent-rest"
                      }
                    />
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPickedColor(null)}
                      aria-pressed={pickedColor === null}
                      aria-label="Use the default color"
                      className={
                        "flex h-7 w-7 items-center justify-center rounded-full border-2 text-[10px] font-medium " +
                        "transition-colors duration-base ease-out-soft " +
                        (pickedColor === null
                          ? "border-accent bg-accent/5 text-accent"
                          : "border-border-soft bg-canvas text-text-soft hover:border-accent/40")
                      }
                    >
                      Auto
                    </button>
                    {COLOR_PALETTE.map((p) => {
                      const selected = pickedColor === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setPickedColor(p.id)}
                          aria-pressed={selected}
                          aria-label={p.label}
                          title={p.label}
                          className={
                            "h-7 w-7 rounded-full bg-gradient-to-br border-2 " +
                            "transition-[border-color,transform] duration-base ease-out-soft " +
                            p.from +
                            " " +
                            p.to +
                            " " +
                            (selected
                              ? "border-text-strong scale-110"
                              : "border-transparent hover:scale-105")
                          }
                        />
                      );
                    })}
                  </div>
                </div>

                <Button
                  size="lg"
                  fullWidth
                  className="mt-8"
                  onClick={() => setStage("pace")}
                  disabled={!nameValid}
                >
                  Continue
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </motion.section>
            )}

            {stage === "pace" && (
              <motion.section
                key="pace"
                {...pageMotion}
                transition={TRANSITION}
                className="flex flex-col"
              >
                <div className="text-center">
                  <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-full bg-accent/10">
                    <Clock className="h-7 w-7 text-accent" strokeWidth={1.75} />
                  </div>
                  <h2 className="font-display text-display-sm text-text-strong text-balance">
                    When approvals are in
                  </h2>
                  <p className="mt-2 text-base text-text-soft">
                    A cooling-off day is the safer pick for shared money. You
                    can change this later.
                  </p>
                </div>

                <div className="mt-8 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <PaceTile
                    selected={delaySeconds === 0}
                    onSelect={() => setDelaySeconds(0)}
                    Icon={Zap}
                    title="Send right away"
                    body="Goes the moment everyone approves."
                  />
                  <PaceTile
                    selected={delaySeconds === 86400}
                    onSelect={() => setDelaySeconds(86400)}
                    Icon={Clock}
                    title="Wait 24 hours"
                    body="A cooling-off day before it ships."
                  />
                </div>

                <Button
                  size="lg"
                  fullWidth
                  className="mt-8"
                  onClick={() => setStage("confirm")}
                >
                  Continue
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </motion.section>
            )}

            {stage === "confirm" && (
              <motion.section
                key="confirm"
                {...pageMotion}
                transition={TRANSITION}
                className="flex flex-col text-center"
              >
                <h2 className="font-display text-display-sm text-text-strong text-balance">
                  Ready to create
                </h2>
                <p className="mt-2 text-base text-text-soft">
                  Two quick wallet popups, then you are sending.
                </p>

                {/* Preview card. Full vibe-check before the user signs:
                    avatar, shape pill, name, the rule, the pace. */}
                <div className="mt-6 rounded-card border border-border-soft bg-surface-raised px-5 py-6 text-left shadow-card-rest">
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className={
                        "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br " +
                        "text-lg font-semibold text-white shadow-card-rest " +
                        ((pickedColor
                          ? COLOR_PALETTE.find((p) => p.id === pickedColor)
                          : COLOR_PALETTE[0])?.from ?? "") +
                        " " +
                        ((pickedColor
                          ? COLOR_PALETTE.find((p) => p.id === pickedColor)
                          : COLOR_PALETTE[0])?.to ?? "")
                      }
                    >
                      {cleanName.charAt(0).toUpperCase() || "?"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-text-soft">
                        {currentShape.label}
                      </p>
                      <p className="font-display text-base text-text-strong">
                        {cleanName || currentShape.defaultName}
                      </p>
                    </div>
                  </div>
                  <ul className="mt-4 flex flex-col gap-2 text-sm text-text-strong">
                    <li className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                      You are the only member to start.
                      {currentShape.expectedMembers > 1
                        ? ` Invite the other ${currentShape.expectedMembers - 1} after.`
                        : ""}
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                      Sends need 1 of 1 approvals (just you, for now).
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                      {delaySeconds === 0
                        ? "Sends ship the moment they are approved."
                        : "Sends wait 24 hours after approval before they ship."}
                    </li>
                  </ul>
                </div>

                {/* Honest popup narration. The team flagged that the
                    wallet popup shows hex bytes and users expect
                    human-readable intent. We cannot change what the
                    wallet shows (Solana signMessage is bytes-only), so
                    we tell the user up front: here is what each popup
                    is for, and the technical-looking text is normal. */}
                <div className="mt-4 rounded-card border border-accent/30 bg-accent/[0.04] p-4 text-left text-sm">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
                    What happens next
                  </p>
                  <ol className="mt-3 flex flex-col gap-3 text-text-strong">
                    <li className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-white">
                        1
                      </span>
                      <span>
                        Your wallet pops up to confirm{" "}
                        <span className="font-medium">create wallet</span>.
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-white">
                        2
                      </span>
                      <span>
                        It pops up again to confirm{" "}
                        <span className="font-medium">enable sending</span>.
                      </span>
                    </li>
                  </ol>
                  <p className="mt-3 text-xs text-text-soft">
                    Heads up. Solana wallets show technical-looking text in
                    the signing prompt instead of a friendly summary. That
                    is normal. The text is the message your wallet is
                    signing for you. Nothing leaves your account at this
                    point; you are setting up rules on chain.
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
                      Create {cleanName || "wallet"}
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
                        `/send?wallet=${encodeURIComponent(slug(cleanName))}`,
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

interface PaceTileProps {
  selected: boolean;
  onSelect: () => void;
  Icon: typeof Zap;
  title: string;
  body: string;
}

function PaceTile({ selected, onSelect, Icon, title, body }: PaceTileProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={
        "flex flex-col items-start gap-2 rounded-card border p-4 text-left " +
        "transition-[border-color,background-color,box-shadow] duration-base ease-out-soft " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas " +
        (selected
          ? "border-accent bg-accent/5 shadow-card-rest"
          : "border-border-soft bg-surface-raised hover:border-accent/40")
      }
    >
      <div
        className={
          "flex h-9 w-9 items-center justify-center rounded-full " +
          (selected ? "bg-accent text-white" : "bg-accent/10 text-accent")
        }
      >
        <Icon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
      </div>
      <p className="text-sm font-medium text-text-strong">{title}</p>
      <p className="text-[11px] leading-snug text-text-soft">{body}</p>
    </button>
  );
}

/// Neutral holding state used by every pre-wizard branch (disconnected,
/// memberships loading, has-existing-wallets redirect). Keeps the
/// create CTA off-screen until we have proof the user needs it.
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
/// Convert the user's friendly label into a valid slug without
/// surfacing the constraint to them. "Soccer Trip" becomes
/// "soccer-trip"; nothing breaks.
function slug(s: string): string {
  return (
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "wallet"
  );
}
