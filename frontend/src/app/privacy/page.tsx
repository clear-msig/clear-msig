"use client";

// Privacy explainer — how Clear keeps shared-wallet rules private.
//
// One page that tells the FHE-via-Encrypt story in retail terms. The
// tone is forward-looking but honest about the pre-alpha state — we
// accepted shipping the UX + marketing now while the network catches
// up. When Encrypt is live, the only thing that changes here is
// dropping the "Preview" callout near the bottom.

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/retail/Button";
import { encryptStatus } from "@/lib/encrypt/client";

export default function PrivacyPage() {
  const reduce = useReducedMotion();
  const status = encryptStatus();

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
      </header>

      <div className="relative z-10 flex flex-1 flex-col items-center px-gutter py-10">
        <motion.section
          {...motionProps}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-2xl"
        >
          <div className="text-center">
            <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-accent">
              <Lock className="h-7 w-7" strokeWidth={1.75} />
            </div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-text-soft">
              How privacy works
            </p>
            <h1 className="mt-2 font-display text-display-md leading-[1.02] text-text-strong text-balance">
              Your rules are{" "}
              <span className="italic text-accent">yours alone</span>.
            </h1>
            <p className="mt-4 max-w-xl text-base text-text-soft">
              Clear&rsquo;s shared wallets are private by design. Who can
              spend, how many friends need to approve, the limits you set
              — none of it is readable by anyone else.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Tile
              Icon={EyeOff}
              title="What stays hidden"
              body="Member list, approval thresholds, allowances per friend, and recipient lists you set up. The wallet works the same — but the rules aren't visible to outsiders."
            />
            <Tile
              Icon={Eye}
              title="What's still public"
              body="Whether the wallet exists. Whether it has approved transactions. The bytes a friend signs. Anything that was always public on a blockchain stays that way."
            />
          </div>

          <div className="mt-10 rounded-card border border-border-soft bg-surface-raised p-6 shadow-card-rest">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                <ShieldCheck className="h-5 w-5" strokeWidth={1.75} />
              </div>
              <div>
                <p className="font-display text-lg text-text-strong">
                  Verified, not just trusted
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-text-soft">
                  Clear uses encryption that lets the on-chain program
                  check approvals against your rules{" "}
                  <em>without ever decrypting them</em>. So the network
                  enforces what you set up — but only your wallet&rsquo;s
                  members can see what those rules are.
                </p>
                <p className="mt-3 text-xs text-text-soft">
                  Powered by{" "}
                  <span className="font-medium text-text-strong">Encrypt</span>
                  &rsquo;s FHE primitives.
                </p>
              </div>
            </div>
          </div>

          {!status.live && (
            <div className="mt-6 rounded-card border border-warning/30 bg-warning/5 p-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-warning">
                Preview note
              </p>
              <p className="mt-2 text-sm leading-relaxed text-text-strong">
                {status.description} When the network switches on, your
                existing wallets transition automatically — no migration,
                no UX changes.
              </p>
            </div>
          )}

          <div className="mt-10 flex justify-center">
            <Link href="/welcome">
              <Button size="lg">
                Try Clear
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Link>
          </div>
        </motion.section>
      </div>
    </main>
  );
}

function Tile({
  Icon,
  title,
  body,
}: {
  Icon: typeof Lock;
  title: string;
  body: string;
}) {
  return (
    <article className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </div>
      <h2 className="mt-4 font-display text-lg text-text-strong">{title}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-text-soft">{body}</p>
    </article>
  );
}
