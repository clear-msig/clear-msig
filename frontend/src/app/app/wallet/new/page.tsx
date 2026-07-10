"use client";

// New shared wallet - the in-app creation flow.
//
// Mirrors the on-chain ceremony that lives at /welcome (one
// createWallet popup + one AddIntent popup, with auto-approve fallback)
// but renders inside the workspace shell so users with at least one
// wallet can spin up another without leaving the app.
//
// On success we route the user to the first useful screen for the
// product they chose. Product intent wins over generic wallet setup.

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { motion, useReducedMotion } from "framer-motion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useConnection, useWallet } from "@/lib/wallet";
import {
  ArrowRight,
  Bot,
  Building2,
  CreditCard,
  Handshake,
  KeyRound,
  Loader2,
  Upload,
  ShieldCheck,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { BackendApiError, BackendTimeoutError } from "@/lib/api/client";
import { backendApi } from "@/lib/api/endpoints";
import { friendlyError } from "@/lib/api/errors";
import { toOnChainName } from "@/lib/retail/walletNames";
import { encryptPolicyBatch } from "@/lib/encrypt/client";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import { useToast } from "@/components/ui/Toast";
import { saveWalletAppearance } from "@/lib/retail/walletAppearance";
import { isValidSolanaAddress, shortAddress } from "@/lib/retail/contacts";
import { getProTreasuryRuntime } from "@/lib/pro/treasury";
import { saveSelectedProductSurface } from "@/lib/productSession";
import { UnsupportedSignerBanner } from "@/components/retail/UnsupportedSignerBanner";
import {
  isProductSurfaceId,
  productSurfaceById,
  type ProductSurfaceId,
} from "@/lib/productSurfaces";

const SOL_TRANSFER_TEMPLATE = "examples/intents/solana_transfer.json";

function isAlreadyInitializedCreateError(err: unknown): boolean {
  const message =
    err instanceof BackendApiError
      ? `${err.message} ${err.payload?.stderr ?? ""}`
      : err instanceof Error
        ? err.message
        : String(err);
  const hay = message.toLowerCase();
  return (
    hay.includes("already exists") ||
    hay.includes("alreadyinitialized") ||
    hay.includes("account already in use") ||
    hay.includes("instruction requires an uninitialized account")
  );
}

function isMaybeLandedCreateError(err: unknown): boolean {
  if (err instanceof BackendTimeoutError) return true;
  if (err instanceof BackendApiError) {
    const statusish = `${err.message} ${err.payload?.kind ?? ""} ${err.payload?.error ?? ""}`.toLowerCase();
    return (
      statusish.includes("status 502") ||
      statusish.includes("status 504") ||
      statusish.includes("proxy_timeout") ||
      statusish.includes("backend is unavailable") ||
      statusish.includes("timed out")
    );
  }
  if (err instanceof Error) {
    const message = err.message.toLowerCase();
    return message.includes("timed out") || message.includes("failed to fetch");
  }
  return false;
}

async function walletExistsAfterCreateFailure(walletSlug: string, err: unknown): Promise<boolean> {
  if (!isMaybeLandedCreateError(err)) return false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
    }
    try {
      await backendApi.showWallet(walletSlug);
      return true;
    } catch {
      /* keep polling briefly; the write may be one confirmation behind */
    }
  }
  return false;
}

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
    blurb: "Solo wallet.",
    defaultName: "My wallet",
    expectedMembers: 1,
  },
  {
    id: "couple",
    label: "Me + a partner",
    blurb: "Two signers.",
    defaultName: "Us",
    expectedMembers: 2,
  },
  {
    id: "family",
    label: "Family",
    blurb: "Household wallet.",
    defaultName: "Family",
    expectedMembers: 4,
  },
  {
    id: "roommates",
    label: "Roommates",
    blurb: "Shared expenses.",
    defaultName: "Roommates",
    expectedMembers: 3,
  },
  {
    id: "team",
    label: "Team",
    blurb: "Team approvals.",
    defaultName: "Team",
    expectedMembers: 5,
  },
];

const PERSONAL_SHAPES = SHAPES.filter((s) => s.id !== "team");

function defaultNameFor(surface: string | null, purpose: "share" | "secure" | "agent" | null): string {
  if (purpose === "agent") return "Agent vault";
  if (surface === "personal") return "My wallet";
  if (surface === "pro") return "Team treasury";
  if (surface === "p2pdefi") return "P2P workspace";
  if (surface === "payments") return "Payments";
  if (purpose === "share") return "Team";
  return "";
}

function productSetupFor(surface: string | null): {
  label: string;
  body: string;
  Icon: LucideIcon;
} {
  if (surface === "pro") {
    return {
      label: "Team treasury",
      body: "People and protection come next.",
      Icon: Building2,
    };
  }
  if (surface === "p2pdefi") {
    return {
      label: "P2P DeFi workspace",
      body: "Counterparty coordination.",
      Icon: Handshake,
    };
  }
  if (surface === "payments") {
    return {
      label: "Payments workspace",
      body: "Payment approvals.",
      Icon: CreditCard,
    };
  }
  return {
    label: "Shared wallet",
    body: "Invite people next.",
    Icon: Users,
  };
}

function agentSetupInfo(): {
  label: string;
  body: string;
  Icon: LucideIcon;
} {
  return {
    label: "Agent vault",
    body: "Choose agent and limits next.",
    Icon: Bot,
  };
}

type ProductChoiceId = "personal" | "pro" | "agent";

const PRODUCT_CHOICES: Array<{
  id: ProductChoiceId;
  Icon: LucideIcon;
}> = [
  {
    id: "personal",
    Icon: Users,
  },
  {
    id: "pro",
    Icon: Building2,
  },
  {
    id: "agent",
    Icon: Bot,
  },
];

export default function NewWalletPage() {
  return (
    <Suspense fallback={<NewWalletSkeleton />}>
      <NewWalletContent />
    </Suspense>
  );
}

function NewWalletContent() {
  const router = useRouter();
  const search = useSearchParams();
  const wallet = useWallet();
  const { connection } = useConnection();
  const { signDescriptor } = useSignWithWallet();
  const toast = useToast();
  const queryClient = useQueryClient();
  const reduce = useReducedMotion();
  const proRuntime = useMemo(() => getProTreasuryRuntime(), []);

  const isBrokenSigner = wallet.signerIssue !== null;
  const signerIssue = wallet.signerIssue;
  const me = wallet.publicKey?.toBase58() ?? "";
  const requestedSurface = useMemo<ProductSurfaceId | null>(() => {
    const requested = search.get("surface");
    return isProductSurfaceId(requested) ? requested : null;
  }, [search]);
  const [surface, setSurface] = useState<ProductSurfaceId | null>(requestedSurface);
  const importMode = search.get("import") === "1" && requestedSurface === "pro";
  const [importText, setImportText] = useState("");

  useEffect(() => {
    setSurface(requestedSurface);
  }, [requestedSurface]);

  // Unified product entry: clear-msig is now the single create flow
  // for both shared wallets (the classic multisig) and Secure
  // personal-key wallets (recovery-capable, single-user). Default =
  // null so the user picks intent first; once chosen, the shared
  // branch reveals the existing shape picker + name form, and the
  // Secure branch routes to /app/secure/new — structurally identical
  // (same Ika dWallet substrate), just a simpler enrollment flow.
  // Same substrate, two product surfaces; one entry. See Fesal
  // feedback 2026-05-11.
  type Purpose = "share" | "secure" | "agent";
  const initialPurpose = useMemo<Purpose | null>(() => {
    const requested = search.get("purpose");
    if (
      requested === "share" ||
      requestedSurface === "personal" ||
      requestedSurface === "pro" ||
      requestedSurface === "p2pdefi" ||
      requestedSurface === "payments"
    ) {
      return "share";
    }
    if (requested === "secure" || requestedSurface === "secure") return "secure";
    if (requested === "agent" || requestedSurface === "agent") return "agent";
    return null;
  }, [search, requestedSurface]);
  const [purpose, setPurpose] = useState<Purpose | null>(initialPurpose);
  const lockedProduct = requestedSurface !== null;

  const [shape, setShape] = useState<ShapeId>(
    requestedSurface === "personal" ? "just_me" : "team",
  );
  const [name, setName] = useState(() =>
    defaultNameFor(requestedSurface, initialPurpose),
  );

  useEffect(() => {
    if (!requestedSurface) return;
    setPurpose(initialPurpose);
    setShape(requestedSurface === "personal" ? "just_me" : "team");
    setName(defaultNameFor(requestedSurface, initialPurpose));
  }, [initialPurpose, requestedSurface]);

  const chooseProduct = (nextSurface: ProductChoiceId) => {
    const nextPurpose: Purpose = nextSurface === "agent" ? "agent" : "share";
    const nextShape: ShapeId = nextSurface === "personal" ? "just_me" : "team";
    setSurface(nextSurface);
    setPurpose(nextPurpose);
    setShape(nextShape);
    if (!name.trim()) setName(defaultNameFor(nextSurface, nextPurpose));
  };

  const chooseDifferentProduct = () => {
    setSurface(null);
    setPurpose(null);
    setShape("team");
    setName("");
  };

  useEffect(() => {
    if (!surface || !me) return;
    saveSelectedProductSurface(surface, me);
  }, [surface, me]);

  const currentShape = useMemo(
    () => SHAPES.find((s) => s.id === shape) ?? SHAPES[0],
    [shape],
  );

  const cleanName = useMemo(() => name.trim(), [name]);
  const importedSigners = useMemo(
    () => parseTreasuryImport(importText, me),
    [importText, me],
  );
  // The on-chain wallet name field is `String<64>`. The frontend
  // appends a 7-byte creator suffix ("#XXXXXX") in toOnChainName so
  // PDAs are unique per (typed-name, creator). Cap the typed name at
  // 57 bytes so the final on-chain name fits the 64-byte limit.
  const nameByteLength = useMemo(
    () => new TextEncoder().encode(cleanName).length,
    [cleanName],
  );
  const nameValid = cleanName.length >= 2 && nameByteLength <= 57;

  // Cooling-off lives on the wallet's spending rule, not the create
  // flow. New wallets default to immediate send (0 delay); the
  // owner can flip it on /app/wallet/[name]/rules later.
  const delaySeconds = 0;

  const setupAll = useMutation({
    mutationFn: async () => {
      if (!me) throw new Error("Connect your wallet first.");
      const walletSlug = toOnChainName(slug(cleanName), me);
      const initialMembers = Array.from(
        new Set([me, ...(importMode ? importedSigners : [])]),
      );
      const threshold = initialMembers.length > 1 ? Math.min(2, initialMembers.length) : 1;

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

      try {
        await backendApi.createWallet({
          name: walletSlug,
          proposers: initialMembers,
          approvers: initialMembers,
          threshold,
          cancellation_threshold: 1,
          timelock: 0,
          policy_ciphertexts: createIds,
        });
      } catch (err) {
        if (isAlreadyInitializedCreateError(err)) {
          // A previous attempt may have landed before the browser heard back.
          // Continue into setup instead of making the user create another wallet.
        } else if (await walletExistsAfterCreateFailure(walletSlug, err)) {
          toast.info("Wallet create confirmed", {
            details: "The wallet exists. Finishing the last step now.",
          });
        } else {
          throw err;
        }
      }

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
      saveWalletAppearance(walletSlug, {
        shape,
        surface: isProductSurfaceId(surface) ? surface : undefined,
      });
      if (isProductSurfaceId(surface)) {
        saveSelectedProductSurface(surface, me);
      }
      toast.success(`${cleanName} is ready`, {
        details:
          purpose === "agent"
            ? "The vault is ready. Choose a trader and set safety checks."
            : "Your wallet is ready. Open it to send your first request.",
      });
      router.push(
        postCreateHref(walletSlug, surface, purpose),
      );
    },
    onError: (err) => {
      console.error("[new-wallet] setupAll failed", err);
      const fe = friendlyError(err, "create-wallet");
      toast.error(fe.title, { details: fe.body });
    },
  });

  const motionProps = reduce
    ? {}
    : {
        initial: { opacity: 0, y: 26, scale: 0.985, filter: "blur(8px)" },
        animate: { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" },
      };
  const setupInfo =
    purpose === "agent" ? agentSetupInfo() : productSetupFor(surface);
  const SetupIcon = setupInfo.Icon;
  const showShapePicker =
    purpose === "share" && surface === "personal";

  if (surface === "p2pdefi") {
    return <ProductComingSoon title="P2P DeFi is coming soon" />;
  }

  return (
    <motion.div
      {...motionProps}
      transition={{
        duration: 0.42,
        ease: [0.22, 1, 0.36, 1],
        scale: { type: "spring", stiffness: 260, damping: 26 },
      }}
      className="mx-auto flex w-full max-w-2xl flex-col gap-6"
    >
      <header className="flex flex-col gap-1">
        <h1 className="hidden md:block font-display text-display-xs leading-tight text-text-strong">
          {purpose === "share"
            ? surface === "personal"
              ? "Create a personal wallet"
              : surface === "pro"
              ? "Create a team treasury"
              : surface === "payments"
                  ? "Create a payments-ready workspace"
              : "New shared wallet"
            : purpose === "secure"
              ? surface === "secure"
                ? "Set up personal recovery"
                : "Secure your key"
              : purpose === "agent"
                ? "Create an agent vault"
              : "Create a wallet"}
        </h1>
        {purpose === null ? (
          <div className="mx-auto max-w-2xl text-center md:mx-0 md:text-left">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.28em] text-accent">
              Choose product
            </p>
            <p className="mt-4 font-display text-[clamp(2.1rem,9vw,4.5rem)] font-medium leading-[0.9] text-text-strong md:hidden">
              What are you here to do?
            </p>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-text-soft md:mt-1">
              Pick the ClearSig workspace that matches how this money will be used.
            </p>
          </div>
        ) : null}
      </header>

      <UnsupportedSignerBanner title="You won't be able to finish creating a wallet with this sign-in" />

      {/* Product picker - in-app wallet creation is product-first.
          Secure is intentionally not shown here because recovery/key
          setup has its own surface; this flow creates workspace
          wallets for Personal, Pro, or Agents. */}
      {purpose === null && (
        <section className="grid grid-cols-3 gap-x-3 gap-y-8 sm:gap-x-5">
          {PRODUCT_CHOICES.map((choice, index) => (
            <ProductChoiceCard
              key={choice.id}
              choice={choice}
              index={index}
              reduce={!!reduce}
              onSelect={() => chooseProduct(choice.id)}
            />
          ))}
        </section>
      )}

      {/* Secure branch — inline threshold picker. Mirrors the shapes
          /app/secure/new offers (solo / 2-of-3 / 3-of-5), but the
          selection happens HERE in the unified clear-msig flow.
          Clicking a shape routes to /app/secure/new with a
          ?preselect=<id> param; that page reads the param and skips
          straight to its confirm step, so the experience reads as
          one continuous flow with no double-pick. */}
      {purpose === "secure" && (
        <section className="flex flex-col gap-4">
          {!lockedProduct && (
            <button
              type="button"
              onClick={() => setPurpose(null)}
              className="self-start font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-text-soft hover:text-text-strong"
            >
              Choose another option
            </button>
          )}

          <div className="rounded-card border border-border-soft bg-surface-raised p-5 sm:p-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-soft">
              Trusted devices
            </p>
            <p className="mt-1 text-xs text-text-soft">
              Choose how many devices must sign.
            </p>

            <div className="mt-4 flex flex-col gap-3">
              {(
                [
                  {
                    id: "solo",
                    label: "Just me",
                    sub: "1 of 1",
                  },
                  {
                    id: "2of3",
                    label: "2 of 3",
                    sub: "Any two devices sign.",
                  },
                  {
                    id: "3of5",
                    label: "3 of 5",
                    sub: "Three of five devices sign.",
                  },
                ] as const
              ).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() =>
                    router.push(
                      `/app/secure/new?surface=secure&preselect=${encodeURIComponent(s.id)}`,
                    )
                  }
                  className={clsx(
                    "group flex items-start justify-between gap-3 rounded-soft border border-border-soft bg-canvas p-4 text-left",
                    "transition-[border-color,background-color,transform] duration-base ease-out-soft",
                    "hover:-translate-y-px hover:border-accent/40 hover:bg-accent/5",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                  )}
                >
                  <div className="flex flex-col gap-1">
                    <p className="font-display text-sm font-semibold leading-tight text-text-strong">
                      {s.label}
                    </p>
                    <p className="text-xs text-text-soft">{s.sub}</p>
                  </div>
                  <ArrowRight
                    className="mt-1 h-4 w-4 shrink-0 text-text-soft transition-colors duration-base ease-out-soft group-hover:text-accent"
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Import path — for users who already have a Solana
              keypair and want to bring it under quorum protection
              instead of generating a fresh key. Routes to the
              dedicated import flow (which handles the secret-key
              entry with the strict no-persistence threat model in
              /app/secure/import/page.tsx). Kept as a low-emphasis
              secondary path so the primary flow stays "create new
              under threshold". */}
          <Link
            href="/app/secure/import?surface=secure"
            className={clsx(
              "group flex items-start justify-between gap-3 rounded-soft border border-border-soft bg-canvas p-4",
              "transition-[border-color,background-color,transform] duration-base ease-out-soft",
              "hover:-translate-y-px hover:border-accent/40 hover:bg-accent/5",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
            )}
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent ring-1 ring-accent/20">
                <KeyRound className="h-4 w-4" strokeWidth={1.75} />
              </span>
              <div className="flex flex-col gap-1">
                <p className="font-display text-sm font-semibold leading-tight text-text-strong">
                  Already have a Solana key?
                </p>
                <p className="text-xs text-text-soft">
                  Bring an existing key into Secure.
                </p>
              </div>
            </div>
            <ArrowRight
              className="mt-1 h-4 w-4 shrink-0 text-text-soft transition-colors duration-base ease-out-soft group-hover:text-accent"
              aria-hidden="true"
            />
          </Link>
        </section>
      )}

      {/* Shared treasury and agent vault creation both start from a
          ClearSig wallet. The post-create route decides whether the
          user lands on wallet overview or the agent launch flow. */}
      {(purpose === "share" || purpose === "agent") && (
        !lockedProduct && (
          <button
            type="button"
            onClick={chooseDifferentProduct}
            className="self-start font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-text-soft hover:text-text-strong"
          >
            Choose a different product
          </button>
        )
      )}
      {(purpose === "share" || purpose === "agent") && (
      <section className="flex flex-col gap-5 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest sm:p-6">
        <ol className="grid grid-cols-3 gap-2">
          {[
            ["1", showShapePicker ? "Preset" : "Workspace"],
            ["2", "Name"],
            ["3", "Create"],
          ].map(([step, label]) => (
            <li
              key={step}
              className="flex items-center gap-2 rounded-soft border border-border-soft bg-canvas px-3 py-2"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 font-numerals text-[11px] font-semibold text-accent">
                {step}
              </span>
              <span className="truncate text-[11px] font-medium text-text-soft">
                {label}
              </span>
            </li>
          ))}
        </ol>

        {showShapePicker ? (
          <div className="flex flex-col gap-3">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-soft">
                Pick a starter wallet
              </span>
              <p className="mt-1 text-xs text-text-soft">
                You can invite more people later.
              </p>
            </div>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {PERSONAL_SHAPES.map((s) => {
                const selected = shape === s.id;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setShape(s.id);
                        if (!name.trim() || name === currentShape.defaultName) {
                          setName(s.defaultName);
                        }
                      }}
                      aria-pressed={selected}
                      className={clsx(
                        "group flex h-full w-full items-start justify-between gap-3 rounded-soft border p-4 text-left",
                        "transition-[border-color,background-color,transform] duration-base ease-out-soft",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
                        selected
                          ? "border-accent bg-accent/[0.08] text-accent"
                          : "border-border-soft bg-canvas text-text-soft hover:-translate-y-px hover:border-accent/40 hover:text-text-strong",
                      )}
                    >
                      <div className="min-w-0">
                        <p className="font-display text-sm font-semibold leading-tight text-text-strong">
                          {s.label}
                        </p>
                        <p className="mt-1 text-xs text-text-soft">
                          {s.blurb}
                        </p>
                      </div>
                      <span
                        className={clsx(
                          "shrink-0 rounded-full border px-2 py-0.5 font-numerals text-[10px] font-semibold tabular-nums",
                          selected
                            ? "border-accent/30 bg-accent/10 text-accent"
                            : "border-border-soft bg-surface-raised text-text-soft",
                        )}
                      >
                        {s.expectedMembers}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div className="rounded-soft border border-border-soft bg-canvas p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                <SetupIcon className="h-4 w-4" strokeWidth={1.75} />
              </span>
              <div className="min-w-0">
                <p className="font-display text-sm font-semibold leading-tight text-text-strong">
                  {setupInfo.label}
                </p>
                <p className="mt-1 text-xs text-text-soft">
                  {setupInfo.body}
                </p>
              </div>
            </div>
          </div>
        )}

        {importMode && surface === "pro" ? (
          <section className="rounded-soft border border-border-soft bg-canvas p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                <Upload className="h-4 w-4" strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-sm font-semibold leading-tight text-text-strong">
                  Import signers
                </p>
                <p className="mt-1 text-xs text-text-soft">
                  {proRuntime.importSources.join(" / ")}
                </p>
              </div>
            </div>
            <textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              rows={5}
              placeholder="name,address,role"
              spellCheck={false}
              className="mt-3 min-h-28 w-full resize-y rounded-soft border border-border-soft bg-surface-raised px-3 py-2 font-mono text-xs leading-relaxed text-text-strong outline-none placeholder:text-text-soft/60 focus:border-accent/50"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-border-soft bg-surface-raised px-2.5 py-1 font-numerals text-[11px] tabular-nums text-text-soft">
                {importedSigners.length + 1} signer{importedSigners.length === 0 ? "" : "s"}
              </span>
              {importedSigners.slice(0, 3).map((address) => (
                <span
                  key={address}
                  className="rounded-full border border-border-soft bg-surface-raised px-2.5 py-1 font-mono text-[10px] text-text-soft"
                >
                  {shortAddress(address)}
                </span>
              ))}
            </div>
          </section>
        ) : null}

        {/* Name */}
        <div className="flex flex-col gap-2">
          <label
            htmlFor="new-wallet-name"
            className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-soft"
          >
            Name your wallet
          </label>
          <div className="flex items-stretch gap-3">
            <span
              aria-hidden="true"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent/15 text-lg font-semibold text-accent ring-1 ring-accent/30"
            >
              {cleanName.charAt(0).toUpperCase() || "?"}
            </span>
            <input
              id="new-wallet-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={currentShape.defaultName}
              maxLength={57}
              autoFocus
              className={clsx(
                "min-w-0 flex-1 rounded-soft border border-border-soft bg-canvas px-3 py-2.5 text-sm text-text-strong outline-none",
                "transition-[border-color,box-shadow] duration-base ease-out-soft",
                "placeholder:text-text-soft/60",
                "focus:border-accent focus:shadow-accent-rest",
              )}
            />
          </div>
        </div>

        <div className="inline-flex items-center gap-2 rounded-soft border border-border-soft bg-canvas px-3 py-2 text-xs text-text-soft">
          <ShieldCheck className="h-3.5 w-3.5 text-accent" strokeWidth={2} aria-hidden="true" />
          <span>Your wallet will ask you to confirm. No funds move.</span>
        </div>

        {/* Create CTA */}
        <button
          type="button"
          onClick={() => setupAll.mutate()}
          disabled={!nameValid || setupAll.isPending || isBrokenSigner}
          className={clsx(
            "inline-flex min-h-tap-lg w-full items-center justify-center gap-2 rounded-soft bg-accent px-5 py-3 text-sm font-semibold text-text-on-accent shadow-accent-rest",
            "transition-[background-color,box-shadow,transform] duration-base ease-out-soft",
            "hover:bg-accent-hover hover:shadow-accent-hover active:scale-[0.98]",
            "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent disabled:hover:shadow-accent-rest",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
          )}
        >
          {setupAll.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Creating
            </>
          ) : isBrokenSigner ? (
            <span className="truncate">Sign in with a different wallet</span>
          ) : (
            <>
              <Sparkles className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
              <span className="truncate">
                Create {cleanName || (purpose === "agent" ? "Agent vault" : currentShape.defaultName)}
              </span>
              <ArrowRight className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
            </>
          )}
        </button>

        {isBrokenSigner && (
          <p className="text-center text-[11px] uppercase tracking-[0.2em] text-text-soft/80">
            This account is on the legacy embedded signer path.
            Recreate the embedded wallet or use a hardware wallet.
          </p>
        )}
      </section>
      )}

      {/* Quiet exit - back to the app entry. Sits below the form so
          the page CTA is always the obvious next step. */}
      <Link
        href="/app"
        className="self-center text-xs text-text-soft transition-colors duration-base ease-out-soft hover:text-text-strong"
      >
        Cancel and go back
      </Link>
    </motion.div>
  );
}

function ProductChoiceCard({
  choice,
  index,
  reduce,
  onSelect,
}: {
  choice: (typeof PRODUCT_CHOICES)[number];
  index: number;
  reduce: boolean;
  onSelect: () => void;
}) {
  const Icon = choice.Icon;
  const surface = productSurfaceById(choice.id);
  return (
    <motion.button
      type="button"
      onClick={onSelect}
      initial={reduce ? false : { opacity: 0, y: 20, scale: 0.96 }}
      animate={reduce ? {} : { opacity: 1, y: 0, scale: 1 }}
      transition={{
        delay: reduce ? 0 : 0.08 + index * 0.055,
        duration: 0.34,
        ease: [0.22, 1, 0.36, 1],
        scale: { type: "spring", stiffness: 360, damping: 28 },
      }}
      className={clsx(
        "group flex min-h-40 flex-col items-center justify-start text-center",
        "transition-[transform,color] duration-base ease-out-soft hover:-translate-y-1",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
      )}
    >
      <span className="inline-flex h-16 w-16 items-center justify-center rounded-[1.35rem] border border-border-soft bg-surface-raised text-text-strong shadow-card-rest transition-colors group-hover:border-accent/45 group-hover:bg-accent/10 group-hover:text-accent">
        <Icon className="h-7 w-7" strokeWidth={1.85} />
      </span>
      <span className="mt-4 block font-display text-base font-semibold text-text-strong sm:text-lg">
        {surface.shortName}
      </span>
      <span className="mt-2 block max-w-[9.5rem] text-xs leading-snug text-text-soft">
        {surface.eyebrow}
      </span>
      <span className="mt-auto inline-flex items-center gap-1.5 pt-4 text-xs font-semibold text-accent">
        Choose
        <ArrowRight
          className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
          strokeWidth={2.3}
        />
      </span>
    </motion.button>
  );
}

// Slug helper - shared with the welcome flow. Keeps the on-chain
// name within the 64-byte limit by trimming, never splitting a
// multi-byte codepoint.
function slug(s: string): string {
  const trimmed = s.trim();
  if (!trimmed) return "wallet";
  const enc = new TextEncoder();
  const bytes = enc.encode(trimmed);
  if (bytes.length <= 64) return trimmed;
  const truncated = enc.encode(trimmed).subarray(0, 64);
  return new TextDecoder("utf-8", { fatal: false }).decode(truncated);
}

function postCreateHref(
  walletSlug: string,
  surface: string | null,
  purpose: "share" | "secure" | "agent" | null,
): string {
  const encoded = encodeURIComponent(walletSlug);
  if (purpose === "agent" || surface === "agent") {
    return `/app/wallet/${encoded}/agents`;
  }
  if (purpose === "secure" || surface === "secure") {
    return `/app/wallet/${encoded}?surface=secure`;
  }
  return `/app/wallet/${encoded}`;
}

function parseTreasuryImport(raw: string, creator: string): string[] {
  const out = new Set<string>();
  const creatorKey = creator.trim();
  for (const token of raw.split(/[\s,;]+/)) {
    const cleaned = token.trim();
    if (!cleaned || cleaned === creatorKey) continue;
    if (isValidSolanaAddress(cleaned)) out.add(cleaned);
  }
  return Array.from(out);
}

function ProductComingSoon({ title }: { title: string }) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20">
          <Sparkles className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="font-display text-lg font-semibold leading-tight text-text-strong">
            {title}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-text-soft">
            P2P DeFi opens after the live product flows are sharper.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          href="/choose"
          className="inline-flex min-h-tap items-center justify-center rounded-soft bg-accent px-4 py-2 text-sm font-medium text-text-on-accent shadow-accent-rest hover:bg-accent-hover"
        >
          Choose another product
        </Link>
        <Link
          href="/p2pdefi"
          className="inline-flex min-h-tap items-center justify-center rounded-soft border border-border-soft bg-canvas px-4 py-2 text-sm font-medium text-text-strong hover:border-accent/40 hover:text-accent"
        >
          View P2P preview
        </Link>
      </div>
    </div>
  );
}

function NewWalletSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <div className="hidden h-9 w-56 animate-pulse rounded bg-border-soft md:block" />
      <div className="h-4 w-72 max-w-full animate-pulse rounded bg-border-soft" />
      <div className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest sm:p-6">
        <div className="h-5 w-32 animate-pulse rounded bg-border-soft" />
        <div className="mt-4 h-12 w-full animate-pulse rounded-soft bg-border-soft" />
        <div className="mt-4 h-12 w-full animate-pulse rounded-soft bg-border-soft" />
      </div>
    </div>
  );
}
