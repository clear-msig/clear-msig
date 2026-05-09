"use client";

// /app/secure — Secure: discovery surface for ikavery, a sister
// project on Ika dWallets that handles t-of-N personal key recovery.
//
// Naming note: the destination is "Secure" (noun-form-of-verb,
// sits naturally next to Settings/Chains in the sidebar). The
// CTA verb is "Secure your key" — verb where verbs belong.
//
// clear-msig is "shared spending"; ikavery is "personal vault" —
// same MPC foundation, distinct user goal. This page is a v1
// promo / hand-off: a clear explainer + one CTA out to
// solana.ikavery.com (the live demo). v2 (deferred) embeds the
// @fesal-packages/ikavery-solana-sdk and runs the import + recover
// flows inside clear-msig.
//
// Visual treatment: clear-msig's primitives (accent rule + caps
// eyebrow + green accent + canvas/surface palette) form the base.
// One nod to ikavery's voice: monospace `// NN` numbered eyebrows
// on the three-step block, mirroring ika.xyz / ikavery's own
// numbered-section style. Plus a "Powered by Ika" pill in the
// Hero that links to ika.xyz.
//
// Copy is direct, benefit-first, low jargon — same voice as the
// landing page's "Why Clear" panel.

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  ExternalLink,
  Fingerprint,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { PageEyebrow } from "@/components/retail/PageEyebrow";
import { BackToWallets } from "@/components/retail/BackToWallets";
import { Button } from "@/components/retail/Button";

const IKAVERY_LIVE = "https://solana.ikavery.com";
const IKAVERY_GITHUB = "https://github.com/Iamknownasfesal/ikavery";
const IKA_SITE = "https://ika.xyz";

export default function VaultPage() {
  const reduce = useReducedMotion();
  const fadeIn = (delay = 0) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 10 },
          animate: { opacity: 1, y: 0 },
          transition: {
            duration: 0.4,
            delay,
            ease: [0.22, 1, 0.36, 1] as const,
          },
        };

  return (
    <motion.div
      {...fadeIn(0)}
      className="flex flex-col gap-10"
    >
      {/* Mobile back chip — Vault is a top-level workspace route
          and StickyTopBar is hidden on mobile, so without this
          the only way back is BottomNav. */}
      <div className="px-gutter md:hidden">
        <BackToWallets label="Wallets" />
      </div>

      <PageEyebrow label="Secure · powered by Ika" align="center">
        <h1 className="font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          Threshold-signed key custody
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-base text-text-soft text-pretty">
          Place your Solana private key behind a quorum of devices and
          passkeys. Recover with any{" "}
          <span className="font-numerals font-semibold text-text-strong">
            3 of 5
          </span>
          . Never lose a key. Never trust a single device.
        </p>
        <a
          href={IKA_SITE}
          target="_blank"
          rel="noreferrer"
          className={
            "mt-5 inline-flex min-h-tap items-center gap-2 rounded-full border border-border-soft bg-surface-raised px-3 py-1.5 text-[11px] font-medium text-text-soft " +
            "transition-[border-color,color] duration-base ease-out-soft hover:border-accent hover:text-accent " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          }
        >
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
          Powered by Ika dWallets
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      </PageEyebrow>

      {/* Three-step block — the only place in the app that uses
          the monospace `// NN` numbered eyebrow. That single
          stylistic nod makes the page read as part of the Ika
          family inside clear-msig. */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Step
          n="01"
          Icon={ShieldCheck}
          title="Build a vault"
          body="Pick a threshold (3 of 5 is the default). The vault is an Ika 2PC-MPC dWallet under your control."
          delay={0.04}
          reduce={!!reduce}
        />
        <Step
          n="02"
          Icon={Fingerprint}
          title="Add devices"
          body="iPhone, MacBook, YubiKey, iPad, Apple Watch. Each device holds a share via WebAuthn passkey."
          delay={0.10}
          reduce={!!reduce}
        />
        <Step
          n="03"
          Icon={KeyRound}
          title="Import your key"
          body="Your private key is sealed inside the dWallet. Recover by signing a sweep with any threshold."
          delay={0.16}
          reduce={!!reduce}
        />
      </section>

      {/* Pre-alpha disclaimer — ikavery itself is explicit about
          this on its landing, and we should be too. Sits before the
          CTA so a user reads it in the right order: "here's the
          warning → here's the open button". */}
      <motion.aside
        {...fadeIn(0.20)}
        className="flex items-start gap-3 rounded-card border border-warning/40 bg-warning/[0.06] p-4 text-sm text-text-soft sm:p-5"
      >
        <ShieldAlert
          className="mt-0.5 h-5 w-5 shrink-0 text-warning"
          strokeWidth={2}
          aria-hidden="true"
        />
        <p className="leading-snug">
          <span className="font-medium text-text-strong">
            Pre-alpha. Devnet only.
          </span>{" "}
          Vault is a proof of concept by{" "}
          <a
            href={IKAVERY_GITHUB}
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:text-accent-hover"
          >
            ikavery
          </a>
          . Don&rsquo;t import a key that holds real funds.
        </p>
      </motion.aside>

      {/* Primary CTA — opens solana.ikavery.com in a new tab.
          v1 hands off to the upstream demo since the SDK isn't
          embedded here yet. Card is accent-tinted so it reads as
          the answer to everything above. */}
      <motion.section
        {...fadeIn(0.24)}
        className="rounded-card border border-accent/40 bg-accent/[0.05] p-6 text-center shadow-card-rest sm:p-8"
      >
        <span aria-hidden="true" className="mx-auto block h-px w-10 bg-accent" />
        <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-accent">
          Try it now
        </p>
        <h2 className="mt-2 font-display text-display-xs leading-tight text-text-strong">
          Secure your key on Solana devnet
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-text-soft">
          The flow lives at{" "}
          <span className="font-mono text-text-strong">solana.ikavery.com</span>
          . Connect, build a vault, sweep when you need to.
        </p>
        <div className="mt-5 flex justify-center">
          <a
            href={IKAVERY_LIVE}
            target="_blank"
            rel="noreferrer"
            className="inline-block"
          >
            <Button size="lg">
              Secure your key
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </a>
        </div>
        <p className="mt-3 text-[11px] text-text-soft">
          Opens in a new tab.
        </p>
      </motion.section>
    </motion.div>
  );
}

interface StepProps {
  n: string;
  Icon: typeof ShieldCheck;
  title: string;
  body: string;
  delay: number;
  reduce: boolean;
}

function Step({ n, Icon, title, body, delay, reduce }: StepProps) {
  const motionProps = reduce
    ? {}
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] as const },
      };
  return (
    <motion.article
      {...motionProps}
      className="flex flex-col rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
      </span>
      {/* Monospace numbered eyebrow — the one ikavery / ika.xyz
          stylistic nod. Different from the rest of the app's caps
          eyebrow on purpose; it signals "powered by Ika" without a
          logo. */}
      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-text-soft">
        // {n}
      </p>
      <h3 className="mt-1 font-display text-base font-semibold text-text-strong">
        {title}
      </h3>
      <p className="mt-1.5 text-sm text-text-soft text-pretty">{body}</p>
    </motion.article>
  );
}
