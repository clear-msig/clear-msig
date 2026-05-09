"use client";

// New shared wallet - the in-app creation flow.
//
// Mirrors the on-chain ceremony that lives at /welcome (one
// createWallet popup + one AddIntent popup, with auto-approve fallback)
// but renders inside the workspace shell so users with at least one
// wallet can spin up another without leaving the app.
//
// On success we route the user straight to the new wallet's detail
// page - no intermediate "wallet ready" celebration, since they're
// already inside the app and just want to use it.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { motion, useReducedMotion } from "framer-motion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useConnection, useWallet } from "@/lib/wallet";
import { ArrowRight, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { backendApi } from "@/lib/api/endpoints";
import { friendlyError } from "@/lib/api/errors";
import { toOnChainName } from "@/lib/retail/walletNames";
import { encryptPolicyBatch } from "@/lib/encrypt/client";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import { useToast } from "@/components/ui/Toast";
import { saveWalletAppearance } from "@/lib/retail/walletAppearance";
import { UnsupportedSignerBanner } from "@/components/retail/UnsupportedSignerBanner";

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

export default function NewWalletPage() {
  const router = useRouter();
  const wallet = useWallet();
  const { connection } = useConnection();
  const { signDescriptor } = useSignWithWallet();
  const toast = useToast();
  const queryClient = useQueryClient();
  const reduce = useReducedMotion();

  const isBrokenSigner = wallet.signerIssue !== null;
  const signerIssue = wallet.signerIssue;
  const me = wallet.publicKey?.toBase58() ?? "";

  const [shape, setShape] = useState<ShapeId>("family");
  const [name, setName] = useState("");

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

  // Cooling-off lives on the wallet's spending rule, not the create
  // flow. New wallets default to immediate send (0 delay); the
  // owner can flip it on /app/wallet/[name]/rules later.
  const delaySeconds = 0;

  const setupAll = useMutation({
    mutationFn: async () => {
      if (!me) throw new Error("Connect your wallet first.");
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
      toast.success(`${cleanName} is ready`, {
        details: "Sending is enabled. Open the wallet to send your first request.",
      });
      router.push(`/app/wallet/${encodeURIComponent(walletSlug)}`);
    },
    onError: (err) => {
      console.error("[new-wallet] setupAll failed", err);
      const fe = friendlyError(err, "create-wallet");
      toast.error(fe.title, { details: fe.body });
    },
  });

  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  return (
    <motion.div
      {...motionProps}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto flex w-full max-w-xl flex-col gap-6"
    >
      {/* Compact header - h1 hidden on mobile (the floating header
          pill carries the title). Subtitle always visible. */}
      <header className="flex flex-col gap-1">
        <h1 className="hidden md:block font-display text-display-xs leading-tight text-text-strong">
          New shared wallet
        </h1>
        <p className="text-xs text-text-soft sm:text-sm">
          Name it, pick who it&rsquo;s for. You can invite friends after.
        </p>
      </header>

      <UnsupportedSignerBanner title="You won't be able to finish creating a wallet with this sign-in" />

      {/* Form card */}
      <section className="flex flex-col gap-5 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest sm:p-6">
        {/* Name */}
        <div className="flex flex-col gap-2">
          <label
            htmlFor="new-wallet-name"
            className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-soft"
          >
            Name it
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

        {/* Shape picker */}
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-soft">
            Who&rsquo;s it for?
          </span>
          <ul className="flex flex-wrap gap-2">
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
                    className={clsx(
                      "rounded-full border px-3.5 py-1.5 text-xs font-medium",
                      "transition-[border-color,background-color,color] duration-base ease-out-soft",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
                      selected
                        ? "border-accent bg-accent/[0.08] text-accent shadow-[0_0_18px_rgba(204,255,0,0.18)]"
                        : "border-border-soft bg-canvas text-text-soft hover:text-text-strong",
                    )}
                  >
                    {s.label}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-text-soft">{currentShape.blurb}</p>
        </div>

        {/* What happens next callout */}
        <div className="rounded-soft border border-border-soft bg-canvas p-3.5">
          <div className="flex items-center gap-2 text-text-soft">
            <ShieldCheck className="h-3.5 w-3.5 text-accent" strokeWidth={2} aria-hidden="true" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em]">
              What happens next
            </span>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-text-soft">
            Your wallet will pop up{" "}
            <span className="font-medium text-text-strong">twice</span> - once
            to create the wallet, once to enable sending. The signing text
            looks technical; that&rsquo;s normal. Nothing leaves your account.
          </p>
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
              Setting up
            </>
          ) : isBrokenSigner ? (
            <span className="truncate">Sign in with a different wallet</span>
          ) : (
            <>
              <Sparkles className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
              <span className="truncate">
                Create {cleanName || currentShape.defaultName}
              </span>
              <ArrowRight className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
            </>
          )}
        </button>

        {isBrokenSigner && (
          <p className="text-center text-[11px] uppercase tracking-[0.2em] text-text-soft/80">
            {signerIssue === "phantom"
              ? "Phantom can't sign clear-msig messages yet."
              : "Email/Google sign-in can't sign Solana yet."}{" "}
            Use <span className="text-accent">Solflare</span>, Backpack, or a
            Ledger.
          </p>
        )}
      </section>

      {/* Quiet exit - back to the wallet hub. Sits below the form so
          the page CTA is always the obvious next step. */}
      <Link
        href="/app/wallet"
        className="self-center text-xs text-text-soft transition-colors duration-base ease-out-soft hover:text-text-strong"
      >
        Cancel and go back
      </Link>
    </motion.div>
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
