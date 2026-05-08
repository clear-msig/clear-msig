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
  Bell,
  Check,
  EyeOff,
  Github,
  Globe,
  Lock,
  Send,
  ShieldCheck,
  UserPlus,
  Users,
  X,
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

      {/* Product preview strip — three mocked cards showing the
          three moments that drive the app: a shared wallet, a
          request waiting on approvals, and the receipt after it
          ships. Static SVG-ish HTML, not real screenshots, so
          they always render correctly and stay theme-aware. The
          row is decorative; no links inside, no role="img" — the
          surrounding context already carries the meaning. */}
      <section className="relative z-10 mx-auto w-full max-w-5xl px-gutter pt-16 sm:pt-20">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <PreviewMock
            kind="wallet"
            reduce={!!reduce}
            delay={0.04}
          />
          <PreviewMock
            kind="request"
            reduce={!!reduce}
            delay={0.10}
          />
          <PreviewMock
            kind="receipt"
            reduce={!!reduce}
            delay={0.16}
          />
        </div>
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

      {/* Why not just a regular multisig — direct comparison vs
          Squads / Safe. Two-column panel: what existing multisigs
          ask of you on the left, what Clear delivers on the right.
          Phrased as user-experience differences (signing UX,
          private rules, multi-chain) not engineering claims. */}
      <section className="relative z-10 mx-auto w-full max-w-4xl px-gutter pt-24 sm:pt-32">
        <motion.div
          {...fadeIn(0)}
          className="flex flex-col items-center text-center"
        >
          <span aria-hidden="true" className="block h-px w-10 bg-accent" />
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
            Why Clear
          </p>
          <h2 className="mt-3 font-display text-display-xs leading-tight text-text-strong text-balance sm:text-display-sm">
            Not your usual multisig
          </h2>
          <p className="mt-3 max-w-2xl text-base text-text-soft text-pretty">
            Squads and Safe ship a power tool with a power-tool UX. Clear
            keeps the same threshold-and-approve model, but rebuilds
            everything around it for friends and family — not treasury ops.
          </p>
        </motion.div>

        <motion.div
          {...fadeIn(0.05)}
          className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2"
        >
          {/* Left column — the friction other multisigs ship with. */}
          <div className="rounded-card border border-border-soft bg-surface-raised p-6 shadow-card-rest">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
              Regular multisig
            </p>
            <ul className="mt-4 flex flex-col gap-3 text-sm text-text-soft">
              <CompareItem
                ok={false}
                strong="Sign a hex blob"
                detail="Your wallet shows raw bytes. You hope they match the request."
              />
              <CompareItem
                ok={false}
                strong="Members + thresholds public"
                detail="Anyone reading on chain can map who's in your wallet."
              />
              <CompareItem
                ok={false}
                strong="One chain at a time"
                detail="Need ETH? Stand up a separate multisig over there. Repeat for BTC."
              />
              <CompareItem
                ok={false}
                strong="Treasury-ops dashboard"
                detail="A console designed for accountants, not a household."
              />
            </ul>
          </div>

          {/* Right column — what Clear actually does. */}
          <div className="rounded-card border border-accent/40 bg-accent/[0.04] p-6 shadow-card-rest">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-accent">
              Clear
            </p>
            <ul className="mt-4 flex flex-col gap-3 text-sm text-text-soft">
              <CompareItem
                ok
                strong="Sign a sentence"
                detail="“Send 5 SOL to Sarah, expires Jan 1.” Your wallet (or Ledger) shows that exact line."
              />
              <CompareItem
                ok
                strong="Members + rules encrypted"
                detail="Spending caps and approver sets live on chain as FHE ciphertext. Verifiable, not readable."
              />
              <CompareItem
                ok
                strong="One key, every chain"
                detail="ETH, BTC, Zcash all sign through Ika dWallets. No bridges, no separate multisigs."
              />
              <CompareItem
                ok
                strong="Built like Cash App"
                detail="Avatar, name, amount. The first screen a friend sees feels like a wallet, not a console."
              />
            </ul>
          </div>
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

// Preview mocks — three little "what this looks like" cards.
// Static markup, not real screenshots, so they always match the
// active theme and never go stale when the app moves.
interface PreviewMockProps {
  kind: "wallet" | "request" | "receipt";
  reduce: boolean;
  delay: number;
}

function PreviewMock({ kind, reduce, delay }: PreviewMockProps) {
  const motionProps = reduce
    ? {}
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] as const },
      };
  return (
    <motion.div
      {...motionProps}
      aria-hidden="true"
      className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest"
    >
      {kind === "wallet" && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
              Family
            </p>
            <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              4 members
            </span>
          </div>
          <p className="mt-3 font-numerals text-2xl font-semibold text-text-strong tabular-nums">
            $4,820.00
          </p>
          <p className="mt-1 text-[11px] text-text-soft">
            Across SOL · ETH · BTC
          </p>
          <div className="mt-4 flex -space-x-2">
            {["from-rose-300 to-orange-300", "from-emerald-300 to-teal-400", "from-violet-300 to-purple-400", "from-sky-300 to-blue-400"].map((bg, i) => (
              <span
                key={i}
                className={
                  "h-7 w-7 rounded-full bg-gradient-to-br ring-2 ring-surface-raised " +
                  bg
                }
              />
            ))}
          </div>
        </>
      )}
      {kind === "request" && (
        <>
          <p className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-accent">
            <Bell className="h-3 w-3" strokeWidth={2.5} />
            Waiting
          </p>
          <p className="mt-2 text-sm font-medium text-text-strong">
            Send <span className="font-numerals">5 SOL</span> to Sarah
          </p>
          <p className="mt-1 text-[11px] text-text-soft">
            for rent · Maya proposed it
          </p>
          <div className="mt-4 flex items-center gap-1.5">
            <span className="h-1.5 flex-1 rounded-full bg-accent" />
            <span className="h-1.5 flex-1 rounded-full bg-accent" />
            <span className="h-1.5 flex-1 rounded-full bg-border-soft" />
            <span className="ml-1 font-numerals text-[10px] font-semibold text-text-strong tabular-nums">
              2/3
            </span>
          </div>
          <button
            type="button"
            tabIndex={-1}
            className="pointer-events-none mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-soft bg-accent px-3 py-2 text-xs font-semibold text-white"
          >
            Approve
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </button>
        </>
      )}
      {kind === "receipt" && (
        <>
          <p className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
            <Check className="h-3 w-3 text-accent" strokeWidth={2.5} />
            Sent
          </p>
          <p className="mt-2 text-sm font-medium text-text-strong">
            5 SOL to Sarah
          </p>
          <p className="mt-1 text-[11px] text-text-soft">2 minutes ago</p>
          <div className="mt-4 flex items-center justify-between rounded-soft border border-border-soft bg-canvas px-3 py-2">
            <span className="text-[11px] text-text-soft">Tx</span>
            <span className="font-mono text-[10px] text-text-strong">
              5dKp…h8Qz
            </span>
          </div>
        </>
      )}
    </motion.div>
  );
}

// Comparison row — one bullet on either side of the "Why Clear"
// panel. `ok` controls icon + tone; the strong/detail split lets
// the user skim the lefthand strong text alone.
function CompareItem({
  ok,
  strong,
  detail,
}: {
  ok: boolean;
  strong: string;
  detail: string;
}) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        aria-hidden="true"
        className={
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full " +
          (ok ? "bg-accent/15 text-accent" : "bg-text-soft/15 text-text-soft")
        }
      >
        {ok ? (
          <Check className="h-3 w-3" strokeWidth={2.5} />
        ) : (
          <X className="h-3 w-3" strokeWidth={2.5} />
        )}
      </span>
      <span className="flex flex-col">
        <span className="text-sm font-medium text-text-strong">{strong}</span>
        <span className="mt-0.5 text-[12px] leading-snug text-pretty">
          {detail}
        </span>
      </span>
    </li>
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
