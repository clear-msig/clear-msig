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
import {
  ArrowRight,
  KeyRound,
  Loader2,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { BackendApiError } from "@/lib/api/client";
import { backendApi } from "@/lib/api/endpoints";
import { friendlyError } from "@/lib/api/errors";
import { toOnChainName } from "@/lib/retail/walletNames";
import { encryptPolicyBatch } from "@/lib/encrypt/client";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import { useToast } from "@/components/ui/Toast";
import { saveWalletAppearance } from "@/lib/retail/walletAppearance";
import { UnsupportedSignerBanner } from "@/components/retail/UnsupportedSignerBanner";

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

  // Unified product entry: clear-msig is now the single create flow
  // for both shared wallets (the classic multisig) and Secure
  // personal-key wallets (recovery-capable, single-user). Default =
  // null so the user picks intent first; once chosen, the shared
  // branch reveals the existing shape picker + name form, and the
  // Secure branch routes to /app/secure/new — structurally identical
  // (same Ika dWallet substrate), just a simpler enrollment flow.
  // Same substrate, two product surfaces; one entry. See Fesal
  // feedback 2026-05-11.
  type Purpose = "share" | "secure";
  const [purpose, setPurpose] = useState<Purpose | null>(null);

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
        if (!isAlreadyInitializedCreateError(err)) throw err;
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
          pill carries the title). Subtitle adapts to purpose. */}
      <header className="flex flex-col gap-1">
        <h1 className="hidden md:block font-display text-display-xs leading-tight text-text-strong">
          {purpose === "share"
            ? "New shared wallet"
            : purpose === "secure"
              ? "Secure your key"
              : "Create a wallet"}
        </h1>
        <p className="text-xs text-text-soft sm:text-sm">
          {purpose === "share"
            ? "Name it, pick who it’s for. You can invite friends after."
            : purpose === null
              ? "One engine, two shapes. Pick the one that fits."
              : "Set a threshold and enroll your devices."}
        </p>
      </header>

      <UnsupportedSignerBanner title="You won't be able to finish creating a wallet with this sign-in" />

      {/* Purpose picker — first step in the unified flow. Both routes
          create an Ika dWallet under the same on-chain program; what
          differs is the lifecycle (propose/approve/execute audit
          trail for shared wallets, enroll/sweep for the personal
          Secure path). Shown only when no purpose chosen yet. */}
      {purpose === null && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => {
              setPurpose("share");
              if (!name.trim()) setName(currentShape.defaultName);
            }}
            className={clsx(
              "group flex flex-col gap-3 rounded-card border border-border-soft bg-surface-raised p-5 text-left",
              "transition-[border-color,background-color,transform] duration-base ease-out-soft",
              "hover:-translate-y-px hover:border-accent/40 hover:bg-accent/5",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
            )}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20">
              <Users className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <div className="flex flex-col gap-1">
              <p className="font-display text-base font-semibold leading-tight text-text-strong">
                Share with people
              </p>
              <p className="text-xs text-text-soft">
                A wallet your group decides on together. Approvals,
                allowance rules, audit trail. Friends, family, team.
              </p>
            </div>
            <span className="mt-auto inline-flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">
              Continue <ArrowRight className="h-3 w-3" strokeWidth={2.5} />
            </span>
          </button>

          <button
            type="button"
            onClick={() => setPurpose("secure")}
            className={clsx(
              "group flex flex-col gap-3 rounded-card border border-border-soft bg-surface-raised p-5 text-left",
              "transition-[border-color,background-color,transform] duration-base ease-out-soft",
              "hover:-translate-y-px hover:border-accent/40 hover:bg-accent/5",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
            )}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20">
              <KeyRound className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <div className="flex flex-col gap-1">
              <p className="font-display text-base font-semibold leading-tight text-text-strong">
                Secure my key
              </p>
              <p className="text-xs text-text-soft">
                A wallet just for you, protected by your devices and
                passkeys. Lose one, sign with the rest. No seed phrase
                to write down.
              </p>
            </div>
            <span className="mt-auto inline-flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">
              Continue <ArrowRight className="h-3 w-3" strokeWidth={2.5} />
            </span>
          </button>
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
          <button
            type="button"
            onClick={() => setPurpose(null)}
            className="self-start font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-text-soft hover:text-text-strong"
          >
            ← Pick a different shape
          </button>

          <div className="rounded-card border border-border-soft bg-surface-raised p-5 sm:p-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-soft">
              Threshold
            </p>
            <p className="mt-1 text-xs text-text-soft">
              How many of your devices have to sign before funds move?
              Higher = safer if a device is lost, more taps when you
              recover.
            </p>

            <div className="mt-4 flex flex-col gap-3">
              {(
                [
                  {
                    id: "solo",
                    label: "Just me",
                    sub: "1 of 1 — only your current device. Fast to set up; lose the device, lose the key.",
                  },
                  {
                    id: "2of3",
                    label: "2 of 3",
                    sub: "You + two passkeys. Any two sign. Tolerates losing one. Two passkey prompts during create.",
                  },
                  {
                    id: "3of5",
                    label: "3 of 5",
                    sub: "Five members, three to recover. Tolerates losing two. Four passkey prompts during create.",
                  },
                ] as const
              ).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() =>
                    router.push(
                      `/app/secure/new?preselect=${encodeURIComponent(s.id)}`,
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
            href="/app/secure/import"
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
                  Import an existing keypair and bring it under quorum
                  protection. Solo for now; thresholds coming.
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

      {/* Existing shared-wallet form. Rendered only after the user
          picks the "Share with people" purpose. The "Secure my key"
          path bounces to /app/secure/new before we get here. */}
      {purpose === "share" && (
        <button
          type="button"
          onClick={() => setPurpose(null)}
          className="self-start font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-text-soft hover:text-text-strong"
        >
          ← Pick a different shape
        </button>
      )}
      {purpose === "share" && (
      <section className="flex flex-col gap-5 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest sm:p-6">
        <ol className="grid grid-cols-3 gap-2">
          {[
            ["1", "Preset"],
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

        {/* Preset picker */}
        <div className="flex flex-col gap-3">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-soft">
              Pick a starter setup
            </span>
            <p className="mt-1 text-xs text-text-soft">
              This only shapes the first screen and default name. You can invite
              people and adjust approvals after the wallet is created.
            </p>
          </div>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {SHAPES.map((s) => {
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
                      <p className="mt-1 text-xs leading-relaxed text-text-soft">
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
            to create the wallet, once to turn on sending. No funds move during
            setup.
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
            This account is on the legacy embedded signer path.
            Recreate the embedded wallet or use a hardware wallet.
          </p>
        )}
      </section>
      )}

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
