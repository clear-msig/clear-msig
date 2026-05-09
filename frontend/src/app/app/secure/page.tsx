"use client";

// /app/secure — Secure: ikavery-powered personal key recovery, integrated
// inside clear-msig.
//
// What this page does:
//   - Reads the user's existing vaults via listVaultsForCreator (fast,
//     one getProgramAccounts call).
//   - When the user has none: shows the explainer + build-a-vault CTA
//     (the v1 promo is now the empty state).
//   - When the user has some: renders a list of vault cards with
//     threshold + member count + status, and tucks the explainer
//     beneath as background.
//   - Always shows the trio of "what you can do" tiles: Build,
//     Add device (stubbed), Sweep (stubbed). v3 will wire those.
//
// Naming note: page label is "Secure" (noun-form, sits next to
// Settings/Chains in the sidebar). The CTA verb is "Secure your key" /
// "Build a vault" — verb where verbs belong.
//
// Visual treatment: clear-msig's primitives form the base; one nod to
// ika.xyz / ikavery's voice via the monospace `// NN` numbered
// eyebrows on the three-step block.

import Link from "next/link";
import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ExternalLink,
  Fingerprint,
  KeyRound,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Vault as VaultIcon,
} from "lucide-react";
import { useConnection, useWallet } from "@/lib/wallet";
import { PageEyebrow } from "@/components/retail/PageEyebrow";
import { BackToWallets } from "@/components/retail/BackToWallets";
import { Button } from "@/components/retail/Button";
import { listVaultsForCreator } from "@/lib/ikavery/clearmsig-actions";
import { type DecodedRecovery } from "@/lib/ikavery/discovery";

const IKAVERY_GITHUB = "https://github.com/Iamknownasfesal/ikavery";
const IKA_SITE = "https://ika.xyz";

export default function SecurePage() {
  const reduce = useReducedMotion();
  const { connection } = useConnection();
  const wallet = useWallet();
  const creator = wallet.publicKey;
  const creatorB58 = creator?.toBase58() ?? "";

  // listVaultsForCreator hits getProgramAccounts; cache + pause when
  // the user isn't connected so we don't spam the RPC.
  const vaultsQuery = useQuery({
    queryKey: ["ikavery-vaults", creatorB58],
    queryFn: () => {
      if (!creator) return Promise.resolve<DecodedRecovery[]>([]);
      return listVaultsForCreator(connection, creator);
    },
    enabled: !!creator && wallet.connected,
    staleTime: 30_000,
  });

  const vaults = vaultsQuery.data ?? [];
  const hasVaults = vaults.length > 0;

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
    <motion.div {...fadeIn(0)} className="flex flex-col gap-10">
      <div className="px-gutter md:hidden">
        <BackToWallets label="Wallets" />
      </div>

      <PageEyebrow label="Secure · powered by Ika" align="center">
        <h1 className="font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          Threshold-signed key custody
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-base text-text-soft text-pretty">
          Place your Solana private key behind a quorum of devices and
          passkeys. Recover with any threshold you set. Never lose a key.
          Never trust a single device.
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

      {/* My vaults — only renders when the user has at least one.
          Empty state rolls into the three-step explainer below. */}
      {hasVaults && (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
              Your vaults · {vaults.length}
            </p>
            <Link
              href="/app/secure/new"
              className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-accent-hover"
            >
              <Plus className="h-3 w-3" />
              Build another
            </Link>
          </div>
          <ul className="flex flex-col gap-2">
            {vaults.map((v) => (
              <VaultCard key={v.recovery.toBase58()} vault={v} />
            ))}
          </ul>
        </section>
      )}

      {/* Empty-state CTA: only when the user has no vaults yet. */}
      {!hasVaults && wallet.connected && !vaultsQuery.isLoading && (
        <motion.section
          {...fadeIn(0.04)}
          className="rounded-card border border-accent/40 bg-accent/[0.05] p-6 text-center shadow-card-rest sm:p-8"
        >
          <span aria-hidden="true" className="mx-auto block h-px w-10 bg-accent" />
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-accent">
            First vault
          </p>
          <h2 className="mt-2 font-display text-display-xs leading-tight text-text-strong">
            You don&rsquo;t have a vault yet
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-text-soft">
            Pick a threshold, place a key behind it, sweep when you need it
            back. Three taps to build the first one.
          </p>
          <div className="mt-5 flex justify-center">
            <Link href="/app/secure/new" className="inline-block">
              <Button size="lg">
                Secure your key
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Link>
          </div>
        </motion.section>
      )}

      {/* Three-step explainer — uses monospace `// NN` numbered
          eyebrows as the one ikavery / ika.xyz visual cue. */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Step
          n="01"
          Icon={ShieldCheck}
          title="Build a vault"
          body="Pick a threshold. The vault is an Ika 2PC-MPC dWallet under your control."
          delay={0.04}
          reduce={!!reduce}
        />
        <Step
          n="02"
          Icon={Fingerprint}
          title="Add devices"
          body="iPhone, MacBook, YubiKey, iPad. Each device holds a share via WebAuthn passkey. (v3)"
          delay={0.10}
          reduce={!!reduce}
          stub
        />
        <Step
          n="03"
          Icon={KeyRound}
          title="Sweep when needed"
          body="Sign a sweep with any threshold. Funds move to your destination wallet. (v3)"
          delay={0.16}
          reduce={!!reduce}
          stub
        />
      </section>

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
          Secure is built on{" "}
          <a
            href={IKAVERY_GITHUB}
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:text-accent-hover"
          >
            ikavery
          </a>
          . Don&rsquo;t store a key that holds real funds.
        </p>
      </motion.aside>
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
  stub?: boolean;
}

function Step({ n, Icon, title, body, delay, reduce, stub }: StepProps) {
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
      className={
        "flex flex-col rounded-card border bg-surface-raised p-5 shadow-card-rest " +
        (stub ? "border-border-soft opacity-70" : "border-border-soft")
      }
    >
      <span
        className={
          "flex h-9 w-9 items-center justify-center rounded-full " +
          (stub ? "bg-text-soft/15 text-text-soft" : "bg-accent/10 text-accent")
        }
      >
        <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-text-soft">
        // {n}
        {stub && <span className="ml-1 text-text-soft">· coming soon</span>}
      </p>
      <h3 className="mt-1 font-display text-base font-semibold text-text-strong">
        {title}
      </h3>
      <p className="mt-1.5 text-sm text-text-soft text-pretty">{body}</p>
    </motion.article>
  );
}

function VaultCard({ vault }: { vault: DecodedRecovery }) {
  const { account } = vault;
  const recoveryStr = vault.recovery.toBase58();
  const short = `${recoveryStr.slice(0, 4)}…${recoveryStr.slice(-4)}`;
  const memberCount = account.members.length;
  const proposalCount = account.proposalCount;
  return (
    <li>
      <Link
        href={`/app/secure/${encodeURIComponent(recoveryStr)}`}
        className={
          "group flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest " +
          "transition-[border-color,transform,box-shadow] duration-base ease-out-soft " +
          "hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-card-raised " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        }
      >
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent"
        >
          <VaultIcon className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-display text-base font-semibold text-text-strong">
            Vault {short}
          </span>
          <span className="text-[11px] text-text-soft">
            <span className="font-numerals tabular-nums">
              {account.threshold}
            </span>
            {" of "}
            <span className="font-numerals tabular-nums">{memberCount}</span>
            {" members · "}
            <span className="font-numerals tabular-nums">{proposalCount}</span>
            {" sweep"}
            {proposalCount === 1 ? "" : "s"}
          </span>
        </span>
        <ArrowRight
          className="h-4 w-4 shrink-0 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-accent"
          aria-hidden="true"
        />
      </Link>
    </li>
  );
}
