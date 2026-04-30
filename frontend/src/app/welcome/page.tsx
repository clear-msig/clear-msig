"use client";

// Welcome flow — first piece of the retail rebuild (locked 2026-04-30).
//
// Tells the create-wallet story in plain language: pick a name → confirm
// → done. No stepper, no "organization / multisig / threshold / signer"
// jargon, no Solana addresses on screen. The technical wallet creation
// runs against the existing backendApi with the connected user as the
// sole initial member; invites are a separate screen later in the story.
//
// Performance budget: 70fps+. Animations are transform/opacity only,
// no backdrop-blur, no heavy framework loaded for this route.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ArrowLeft, Check, Loader2, Users } from "lucide-react";
import { useWalletGate } from "@/lib/hooks/useWalletGate";
import { backendApi } from "@/lib/api/endpoints";
import { BackendApiError } from "@/lib/api/client";
import { appConfig } from "@/lib/config";
import { encryptPolicyBatch } from "@/lib/encrypt/client";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/retail/Button";

type Stage = "intro" | "name" | "confirm" | "success";

const STAGES: Stage[] = ["intro", "name", "confirm", "success"];
const PROGRESS_STAGES: Stage[] = ["intro", "name", "confirm"];

const NAME_SUGGESTIONS = [
  "Roommates",
  "Family",
  "Soccer Trip",
  "Book Club",
  "Wedding",
];

// Single source of timing/easing — the perf budget says compositor-only,
// so every transition stays on opacity + transform.
const TRANSITION = { duration: 0.25, ease: [0.22, 1, 0.36, 1] as const };

export default function WelcomePage() {
  const gate = useWalletGate();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const reduce = useReducedMotion();

  const [stage, setStage] = useState<Stage>("intro");
  const [name, setName] = useState("");

  const cleanName = useMemo(() => name.trim(), [name]);
  const nameValid = cleanName.length >= 2 && cleanName.length <= 64;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!gate.publicKey) throw new Error("Connect your wallet first");
      const proposers = [gate.publicKey];
      const approvers = [gate.publicKey];
      const threshold = 1;

      // Encrypt policy fields through Encrypt's surface BEFORE the
      // backend submission. At Alpha 1 the returned identifiers
      // travel on chain instead of plaintext; today's pre-alpha
      // returns plaintext-as-ciphertext but the call path is real.
      const enc = new TextEncoder();
      await encryptPolicyBatch([
        { plaintext: enc.encode(JSON.stringify(proposers)), fheType: "ebytes" },
        { plaintext: enc.encode(JSON.stringify(approvers)), fheType: "ebytes" },
        { plaintext: new Uint8Array([threshold]), fheType: "euint8" },
      ]);

      return backendApi.createWallet({
        name: slug(cleanName),
        proposers,
        approvers,
        threshold,
        cancellation_threshold: 1,
        timelock: 0,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-organizations"] });
      setStage("success");
    },
    onError: (err) => {
      console.error("[welcome] createWallet failed", err);
      const msg =
        err instanceof BackendApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Something went wrong";
      // "Failed to fetch" is the browser-level network error — the most
      // common cause is the backend simply not running locally. Surface
      // the URL we tried so the user can act on it.
      const isNetwork =
        msg === "Failed to fetch" ||
        msg === "NetworkError when attempting to fetch resource.";
      if (isNetwork) {
        toast.error("Can't reach the server", {
          details:
            `Tried ${appConfig.backendApiUrl}/wallets. ` +
            "If you're running locally, start the backend with " +
            "`cargo run -p clear-msig-backend-api` from the workspace root.",
          durationMs: 0,
        });
      } else {
        const details =
          err instanceof BackendApiError && err.payload
            ? JSON.stringify(err.payload, null, 2)
            : undefined;
        toast.error(msg, { details, durationMs: 0 });
      }
    },
  });

  const pageMotion = reduce
    ? { initial: false, animate: { opacity: 1 }, exit: { opacity: 1 } }
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -12 },
      };

  const stageIdx = STAGES.indexOf(stage);

  return (
    <main className="relative flex min-h-screen flex-col bg-canvas">
      {/* Progress dots — three steps in the user story (intro → name → confirm).
          Success is a payoff state, not a step, so it's not represented. */}
      <div
        aria-hidden="true"
        className="flex items-center justify-center gap-2 px-gutter pt-8"
      >
        {PROGRESS_STAGES.map((s, i) => {
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

      <div className="flex flex-1 items-center justify-center px-gutter pb-12">
        <div className="w-full max-w-md">
          <AnimatePresence mode="wait" initial={false}>
            {stage === "intro" && (
              <motion.section
                key="intro"
                {...pageMotion}
                transition={TRANSITION}
                className="flex flex-col items-center text-center"
              >
                <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-accent/10">
                  <Users className="h-8 w-8 text-accent" strokeWidth={1.75} />
                </div>
                <h1 className="font-display text-display-sm text-text-strong">
                  A wallet you share
                </h1>
                <p className="mt-3 text-base text-text-soft">
                  Send money with people you trust — friends, family, your
                  team. Everyone sees what&apos;s happening, and you decide
                  together.
                </p>
                <Button
                  size="lg"
                  fullWidth
                  className="mt-8"
                  onClick={() => setStage("name")}
                >
                  Create your first wallet
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </motion.section>
            )}

            {stage === "name" && (
              <motion.section
                key="name"
                {...pageMotion}
                transition={TRANSITION}
                className="flex flex-col"
              >
                <h2 className="text-center font-display text-display-sm text-text-strong">
                  What do you want to call it?
                </h2>
                <p className="mt-2 text-center text-base text-text-soft">
                  Pick something you and your friends will recognize.
                </p>

                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Roommates"
                  autoFocus
                  maxLength={64}
                  className={
                    "mt-8 w-full rounded-card border border-border-soft bg-surface-raised " +
                    "px-5 py-4 text-lg text-text-strong placeholder:text-text-soft " +
                    "outline-none transition-[border-color,box-shadow] duration-base ease-out-soft " +
                    "focus:border-accent focus:shadow-accent-rest"
                  }
                />

                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {NAME_SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setName(s)}
                      className={
                        "rounded-full border border-border-soft bg-surface-raised " +
                        "px-3 py-1.5 text-sm text-text-soft " +
                        "transition-colors duration-base ease-out-soft " +
                        "hover:border-accent hover:text-accent " +
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                      }
                    >
                      {s}
                    </button>
                  ))}
                </div>

                <div className="mt-8 flex items-center justify-between gap-3">
                  <Button
                    variant="ghost"
                    size="md"
                    onClick={() => setStage("intro")}
                  >
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
                  </Button>
                  <Button
                    size="lg"
                    onClick={() => setStage("confirm")}
                    disabled={!nameValid}
                  >
                    Continue
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </motion.section>
            )}

            {stage === "confirm" && (
              <motion.section
                key="confirm"
                {...pageMotion}
                transition={TRANSITION}
                className="flex flex-col text-center"
              >
                <h2 className="font-display text-display-sm text-text-strong">
                  Ready to create
                </h2>
                <div className="mt-6 rounded-card border border-border-soft bg-surface-raised px-5 py-6">
                  <p className="text-sm text-text-soft">Your shared wallet</p>
                  <p className="mt-1 font-display text-display-xs text-text-strong">
                    {cleanName}
                  </p>
                </div>
                <p className="mt-4 text-base text-text-soft">
                  You&apos;ll be the first member. You can add friends right
                  after.
                </p>

                <div className="mt-8 flex items-center justify-between gap-3">
                  <Button
                    variant="ghost"
                    size="md"
                    onClick={() => setStage("name")}
                    disabled={mutation.isPending}
                  >
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
                  </Button>
                  <Button
                    size="lg"
                    onClick={() => mutation.mutate()}
                    disabled={mutation.isPending || !nameValid}
                  >
                    {mutation.isPending ? (
                      <>
                        <Loader2
                          className="h-4 w-4 animate-spin"
                          aria-hidden="true"
                        />{" "}
                        Creating…
                      </>
                    ) : (
                      <>
                        Create wallet
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </>
                    )}
                  </Button>
                </div>
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
                <h2 className="font-display text-display-sm text-text-strong">
                  {cleanName} is ready
                </h2>
                <p className="mt-3 text-base text-text-soft">
                  Set up sending next, then start moving money.
                </p>
                <div className="mt-8 flex w-full flex-col gap-3">
                  <Button
                    size="lg"
                    fullWidth
                    onClick={() =>
                      router.push(
                        `/app/wallet/${encodeURIComponent(slug(cleanName))}`,
                      )
                    }
                  >
                    Open {cleanName}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </motion.section>
            )}
          </AnimatePresence>
        </div>
      </div>

      {!gate.connected && (
        <p
          role="status"
          className="px-gutter pb-8 text-center text-sm text-text-soft"
        >
          Sending you to connect a wallet…
        </p>
      )}
    </main>
  );
}

// Wallet names go on chain and the existing backend allows only
// [a-zA-Z0-9_-]. Convert the user's friendly label into a valid slug
// without exposing the constraint to them — they typed "Soccer Trip",
// the chain stores "soccer-trip".
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
