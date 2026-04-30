"use client";

// Set up sending — single-tap spending-rule bootstrap.
//
// A freshly-created wallet has no on-chain intents (spending rules)
// yet, so creating a request to send money fails. This screen wraps
// the prepare → sign → submit flow that adds a default SolTransfer
// intent into one user-visible action: "Set up sending."
//
// Approvers default to just the connected user (matching the
// /welcome flow's wallet-creation defaults). When the contacts /
// member-management layer lands, this should expand to the full
// member set.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useWallet } from "@solana/wallet-adapter-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Clock, Loader2, Send, Zap } from "lucide-react";
import { backendApi } from "@/lib/api/endpoints";
import { BackendApiError } from "@/lib/api/client";
import { appConfig } from "@/lib/config";
import { encryptPolicyBatch } from "@/lib/encrypt/client";
import { fromHex } from "@/lib/msig";
import { useSignWithWallet, WalletSignError } from "@/lib/hooks/useSignWithWallet";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/retail/Button";

// Backend reads template files relative to the workspace root. The
// SolTransfer template gives the wallet a generic "send to anyone, any
// amount" rule — what a retail user expects from "send money."
const TEMPLATE_FILE = "examples/intents/solana_transfer.json";

export default function SetupSpendingPage() {
  const params = useParams<{ name: string }>();
  const name = useMemo(() => {
    try {
      return decodeURIComponent(params?.name ?? "");
    } catch {
      return params?.name ?? "";
    }
  }, [params?.name]);

  const router = useRouter();
  const wallet = useWallet();
  const { signBytes } = useSignWithWallet();
  const toast = useToast();
  const reduce = useReducedMotion();
  const queryClient = useQueryClient();

  // Time-lock choice. 0 = ship immediately once approvals land.
  // 24 * 3600 = 86_400s wait. Per the retail-pivot Months 3-4 spec,
  // this is "Wait 24h before sending" — a cooling-off period for
  // shared wallets that want a buffer against impulse / mistakes.
  const [delaySeconds, setDelaySeconds] = useState<number>(0);

  const setup = useMutation({
    mutationFn: async () => {
      if (!wallet.publicKey) {
        throw new Error("Connect your wallet first");
      }
      const me = wallet.publicKey.toBase58();
      const proposers = [me];
      const approvers = [me];
      const threshold = 1;

      // 0. Encrypt the policy fields client-side via the Encrypt
      //    surface. Pre-alpha returns plaintext-as-ciphertext; the
      //    call path is the real one Alpha 1 uses.
      const enc = new TextEncoder();
      await encryptPolicyBatch([
        { plaintext: enc.encode(JSON.stringify(proposers)), fheType: "ebytes" },
        { plaintext: enc.encode(JSON.stringify(approvers)), fheType: "ebytes" },
        { plaintext: new Uint8Array([threshold]), fheType: "euint8" },
        { plaintext: new Uint8Array([delaySeconds & 0xff]), fheType: "euint32" },
      ]);

      // 1. Prepare: backend builds the unsigned add-intent transaction
      //    and returns the bytes the user has to sign.
      const dry = await backendApi.prepare.addIntent(name, {
        file: TEMPLATE_FILE,
        proposers,
        approvers,
        threshold,
        cancellation_threshold: 1,
        timelock: delaySeconds,
      });

      // 2. Sign: user's wallet pops up its sign-message UI.
      const signed = await signBytes(fromHex(dry.message_hex));

      // 3. Submit: backend takes the signature + bytes and submits
      //    the on-chain transaction.
      return backendApi.submit.addIntent(name, {
        ...signed,
        params_data_hex: dry.params_data_hex,
        expiry: dry.expiry,
        file: TEMPLATE_FILE,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wallet-intents"] });
      queryClient.invalidateQueries({ queryKey: ["wallet", name] });
      toast.success("Sending is set up");
      router.push(`/app/wallet/${encodeURIComponent(name)}`);
    },
    onError: (err) => {
      console.error("[setup-spending]", err);
      // Network error → backend down. Surface URL + start command.
      const msg =
        err instanceof BackendApiError
          ? err.message
          : err instanceof WalletSignError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Setup failed";
      const isNetwork =
        msg === "Failed to fetch" ||
        msg === "NetworkError when attempting to fetch resource.";
      if (isNetwork) {
        toast.error("Can't reach the server", {
          details:
            `Tried ${appConfig.backendApiUrl}. ` +
            "Start the backend with `cargo run -p clear-msig-backend-api`.",
          durationMs: 0,
        });
      } else {
        // Surface the underlying CLI / backend payload so user can
        // see WHY it failed instead of a generic "command failed".
        const details =
          err instanceof BackendApiError && err.payload
            ? JSON.stringify(err.payload, null, 2)
            : undefined;
        toast.error(msg, { details, durationMs: 0 });
      }
    },
  });

  const motionProps = reduce
    ? {}
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
      };

  return (
    <main className="relative flex min-h-screen flex-col bg-canvas">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -left-32 -top-16 h-[55vh] w-[80vw] max-w-[640px] rounded-full bg-accent/[0.06] blur-3xl" />
      </div>

      <header className="relative z-10 flex items-center justify-between px-gutter pt-6">
        <Link
          href={`/app/wallet/${encodeURIComponent(name)}`}
          className={
            "-ml-2 inline-flex items-center gap-1.5 rounded-soft px-2 py-1 text-sm text-text-soft " +
            "transition-colors duration-base ease-out-soft hover:text-text-strong " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          }
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {name}
        </Link>
      </header>

      <div className="relative z-10 flex flex-1 items-center justify-center px-gutter py-10">
        <motion.section
          {...motionProps}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-md"
        >
          <div className="flex flex-col items-center text-center">
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-accent">
              <Send className="h-7 w-7" strokeWidth={1.75} />
            </div>
            <h1 className="font-display text-display-sm leading-[1.05] text-text-strong text-balance">
              Set up sending in {name}
            </h1>
            <p className="mt-3 max-w-sm text-base text-text-soft">
              One quick setup so this wallet can send money. Your wallet
              will ask you to confirm — that&rsquo;s how the rule
              becomes part of {name}.
            </p>

            <div className="mt-6 w-full rounded-card border border-border-soft bg-surface-raised p-5 text-left shadow-card-rest">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
                What this enables
              </p>
              <ul className="mt-3 flex flex-col gap-2 text-sm text-text-strong">
                <li className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  Anyone in the wallet can request to send money out.
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  Your wallet&rsquo;s approval rules apply (right now,
                  just you).
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  You can change this later when you have more
                  friends.
                </li>
              </ul>
            </div>

            {/* Optional cooling-off period — `timelockSeconds` on the
                intent. Defaults to ship-immediately; 24h is the
                second-thoughts buffer for shared wallets. */}
            <div className="mt-4 w-full rounded-card border border-border-soft bg-surface-raised p-5 text-left shadow-card-rest">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
                When approvals are in
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <SpeedOption
                  selected={delaySeconds === 0}
                  onSelect={() => setDelaySeconds(0)}
                  Icon={Zap}
                  title="Send right away"
                  body="Goes the moment everyone approves."
                />
                <SpeedOption
                  selected={delaySeconds === 86400}
                  onSelect={() => setDelaySeconds(86400)}
                  Icon={Clock}
                  title="Wait 24 hours"
                  body="A cooling-off day before it ships."
                />
              </div>
            </div>

            <Button
              size="lg"
              fullWidth
              className="mt-6"
              onClick={() => setup.mutate()}
              disabled={setup.isPending}
            >
              {setup.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Setting up…
                </>
              ) : (
                <>
                  Enable sending
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </>
              )}
            </Button>
          </div>
        </motion.section>
      </div>
    </main>
  );
}

// ─── Speed option tile ─────────────────────────────────────────────

interface SpeedOptionProps {
  selected: boolean;
  onSelect: () => void;
  Icon: typeof Zap;
  title: string;
  body: string;
}

function SpeedOption({
  selected,
  onSelect,
  Icon,
  title,
  body,
}: SpeedOptionProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={
        "flex flex-col items-start gap-1 rounded-card border p-3 text-left " +
        "transition-[border-color,background-color,box-shadow] duration-base ease-out-soft " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised " +
        (selected
          ? "border-accent bg-accent/5 shadow-card-rest"
          : "border-border-soft bg-canvas hover:border-accent/40")
      }
    >
      <div
        className={
          "flex h-7 w-7 items-center justify-center rounded-full " +
          (selected ? "bg-accent text-white" : "bg-accent/10 text-accent")
        }
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={2} />
      </div>
      <p className="mt-1 text-sm font-medium text-text-strong">{title}</p>
      <p className="text-[11px] leading-snug text-text-soft">{body}</p>
    </button>
  );
}
