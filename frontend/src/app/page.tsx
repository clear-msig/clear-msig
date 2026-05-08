"use client";

// Landing page — retail rebuild (locked 2026-04-30).
//
// Replaces the multi-section pitch deck (hero terminal, problem panel,
// before/after Ledger comparison, chains grid, dual marquees,
// architecture diagram, MPC system circuit, vault graphic) with a
// short, calm retail page:
//
//   1. Hero — what this is, in plain language, with one CTA.
//   2. Three-step "how it works".
//   3. Trust callout — the FHE-encrypted-policy line, framed for
//      non-technical readers.
//   4. Final CTA + retail footer.
//
// No 3D scenes, no constellation backgrounds, no scroll-triggered
// dramatic animations — this is the public face of the product and
// has to feel like Cash App, not a treasury console pitch.

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  EyeOff,
  Github,
  Globe,
  Lock,
  Send,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { useWalletGate } from "@/lib/hooks/useWalletGate";
import { HeaderBar } from "@/components/layout/HeaderBar";
import { Button } from "@/components/retail/Button";

export default function HomePage() {
  useWalletGate();
  const reduce = useReducedMotion();

  const fadeIn = (delay = 0) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 12 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] as const },
        };

  return (
    <main className="relative flex min-h-screen flex-col bg-canvas">
      {/* One soft accent wash for atmosphere — paints once on mount,
          no animation, no backdrop-blur. Matches the welcome flow. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -left-32 top-0 h-[60vh] w-[80vw] max-w-[760px] rounded-full bg-accent/[0.06] blur-3xl" />
      </div>

      <HeaderBar />

      {/* Hero */}
      <section className="relative z-10 mx-auto flex w-full max-w-3xl flex-col items-center px-gutter pt-32 text-center sm:pt-40">
        <motion.span
          {...fadeIn(0)}
          className="rounded-full border border-border-soft bg-surface-raised px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft"
        >
          Shared wallets
        </motion.span>

        <motion.h1
          {...fadeIn(0.05)}
          className="mt-6 font-display text-display-md leading-[1.02] text-text-strong text-balance sm:text-display-lg"
        >
          Send money with people you{" "}
          <span className="text-accent">trust</span>.
        </motion.h1>

        <motion.p
          {...fadeIn(0.12)}
          className="mt-5 max-w-xl text-base text-text-soft text-pretty sm:text-lg"
        >
          A shared wallet for friends, family, or your team. Anyone can
          ask, everyone agrees, and nobody has to handle keys alone.
        </motion.p>

        <motion.div {...fadeIn(0.18)} className="mt-8">
          <Link href="/welcome">
            <Button size="lg">
              Get started
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </Link>
        </motion.div>
      </section>

      {/* How it works */}
      <section className="relative z-10 mx-auto w-full max-w-5xl px-gutter pt-24 sm:pt-32">
        <motion.h2
          {...fadeIn(0)}
          className="text-center font-display text-display-xs leading-tight text-text-strong sm:text-display-sm"
        >
          How it works
        </motion.h2>

        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Step
            index={1}
            Icon={Users}
            title="Create a wallet"
            body="Name it for the trip, the house, the team. Invite a few friends."
            reduce={!!reduce}
            delay={0.04}
          />
          <Step
            index={2}
            Icon={Send}
            title="Anyone can ask"
            body="Need to send money out? Tap the amount, pick who, write a note."
            reduce={!!reduce}
            delay={0.10}
          />
          <Step
            index={3}
            Icon={UserPlus}
            title="Friends approve"
            body="Everyone sees the request. A quick tap from each, then it sends."
            reduce={!!reduce}
            delay={0.16}
          />
        </div>
      </section>

      {/* Trust callout */}
      <section className="relative z-10 mx-auto w-full max-w-3xl px-gutter pt-24 sm:pt-32">
        <motion.div
          {...fadeIn(0)}
          className="rounded-card border border-border-soft bg-surface-raised p-8 shadow-card-rest sm:p-10"
        >
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
              <Lock className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div>
              <h3 className="font-display text-display-xs leading-tight text-text-strong">
                Private by default
              </h3>
              <p className="mt-2 text-base text-text-soft">
                Who&rsquo;s in the wallet, who can spend, and the rules
                you set are kept private. Verified on-chain, but no one
                else can read them. Not us, not anyone.
              </p>
            </div>
          </div>
        </motion.div>
      </section>

      {/* Built on — what powers Clear under the hood. Three pieces:
          the Solana program (the rules that gate every send), the
          Ika dWallet network (one Solana key signs across SOL, ETH,
          BTC, and Zcash with no bridges), and Encrypt FHE (spending
          policies live on chain as ciphertext, verifiable but
          unreadable). One paragraph each — enough to ground a
          technical reader without scaring off the casual one. */}
      <section className="relative z-10 mx-auto w-full max-w-5xl px-gutter pt-24 sm:pt-32">
        <motion.div
          {...fadeIn(0)}
          className="flex flex-col items-center text-center"
        >
          <span aria-hidden="true" className="block h-px w-10 bg-accent" />
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
            Built on
          </p>
          <h2 className="mt-3 font-display text-display-xs leading-tight text-text-strong text-balance sm:text-display-sm">
            Open-source rails, end to end
          </h2>
          <p className="mt-3 max-w-2xl text-base text-text-soft text-pretty">
            One Solana key, one set of rules, every chain. Built from three
            pieces, all open source. Every signature is auditable.
          </p>
        </motion.div>

        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StackCard
            Icon={ShieldCheck}
            kicker="Solana program"
            title="The rules layer"
            body="A Rust contract on Solana enforces threshold approvals, spending limits, and timelocks before any transaction signs. Open source; same byte-exact preimage on chain and in the client."
            reduce={!!reduce}
            delay={0.04}
          />
          <StackCard
            Icon={Globe}
            kicker="Ika dWallet network"
            title="One key, every chain"
            body="The dWallet's pubkey IS your address on each destination chain. ETH, BTC, and Zcash transfers are signed by your Solana key through Ika's 2PC-MPC network. No bridges, no wrapped assets."
            reduce={!!reduce}
            delay={0.10}
            href="https://ika.xyz"
          />
          <StackCard
            Icon={EyeOff}
            kicker="Encrypt · FHE"
            title="Policies stay private"
            body="Member lists, approval thresholds, and spending caps live on chain as fully-homomorphic ciphertext. Verifiable but unreadable — by us, by validators, by anyone."
            reduce={!!reduce}
            delay={0.16}
            href="https://encrypt.xyz"
          />
        </div>

        <motion.div
          {...fadeIn(0.22)}
          className="mt-6 flex items-center justify-center gap-3 text-xs text-text-soft"
        >
          <Github className="h-3.5 w-3.5" aria-hidden="true" />
          <a
            href="https://github.com/clear-msig/clear-msig"
            target="_blank"
            rel="noreferrer"
            className="rounded-soft px-1.5 py-0.5 transition-colors duration-base ease-out-soft hover:text-text-strong"
          >
            github.com/clear-msig/clear-msig
          </a>
        </motion.div>
      </section>

      {/* Final CTA */}
      <section className="relative z-10 mx-auto w-full max-w-3xl px-gutter py-24 text-center sm:py-32">
        <motion.h2
          {...fadeIn(0)}
          className="font-display text-display-sm leading-[1.05] text-text-strong text-balance"
        >
          Ready when you are.
        </motion.h2>
        <motion.div {...fadeIn(0.06)} className="mt-6">
          <Link href="/welcome">
            <Button size="lg">
              Create your first wallet
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </Link>
        </motion.div>
      </section>

      <Footer />
    </main>
  );
}

interface StepProps {
  index: number;
  Icon: typeof Users;
  title: string;
  body: string;
  reduce: boolean;
  delay: number;
}

function Step({ index, Icon, title, body, reduce, delay }: StepProps) {
  const motionProps = reduce
    ? {}
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] as const },
      };
  return (
    <motion.article
      {...motionProps}
      className="rounded-card border border-border-soft bg-surface-raised p-6 shadow-card-rest"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <span className="font-mono text-xs tracking-wider text-text-soft">
          0{index}
        </span>
      </div>
      <h3 className="mt-4 font-display text-xl text-text-strong">{title}</h3>
      <p className="mt-2 text-sm text-text-soft">{body}</p>
    </motion.article>
  );
}

// One stack card. Same shape as <Step> above — accent-tinted icon,
// caps kicker, headline, body. Optional `href` turns it into a Link
// so the Ika and Encrypt cards point at the upstream project pages
// without a separate "learn more" row.
interface StackCardProps {
  Icon: typeof Users;
  kicker: string;
  title: string;
  body: string;
  reduce: boolean;
  delay: number;
  href?: string;
}

function StackCard({
  Icon,
  kicker,
  title,
  body,
  reduce,
  delay,
  href,
}: StackCardProps) {
  const motionProps = reduce
    ? {}
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] as const },
      };
  const inner = (
    <>
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
        {kicker}
      </p>
      <h3 className="mt-1.5 font-display text-xl text-text-strong">
        {title}
      </h3>
      <p className="mt-2 text-sm text-text-soft text-pretty">{body}</p>
      {href && (
        <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent">
          Learn more
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </span>
      )}
    </>
  );

  const className =
    "group flex h-full flex-col rounded-card border border-border-soft bg-surface-raised p-6 shadow-card-rest " +
    "transition-[border-color,transform,box-shadow] duration-base ease-out-soft " +
    (href
      ? "hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-card-raised "
      : "");

  if (href) {
    return (
      <motion.a
        {...motionProps}
        href={href}
        target="_blank"
        rel="noreferrer"
        className={className}
      >
        {inner}
      </motion.a>
    );
  }

  return (
    <motion.article {...motionProps} className={className}>
      {inner}
    </motion.article>
  );
}

function Footer() {
  return (
    <footer className="relative z-10 border-t border-border-soft bg-surface-raised">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-start justify-between gap-6 px-gutter py-8 sm:flex-row sm:items-center">
        <div>
          <p className="font-display text-base font-semibold text-text-strong">
            Clear
          </p>
          <p className="mt-1 text-xs text-text-soft">
            Send money with people you trust.
          </p>
        </div>
        <div className="flex items-center gap-5 text-xs text-text-soft">
          <a
            href="https://github.com/clear-msig/clear-msig"
            target="_blank"
            rel="noreferrer"
            className="transition-colors duration-base ease-out-soft hover:text-text-strong"
          >
            GitHub
          </a>
          <Link
            href="/welcome"
            className="transition-colors duration-base ease-out-soft hover:text-text-strong"
          >
            Get started
          </Link>
        </div>
      </div>
    </footer>
  );
}
