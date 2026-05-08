"use client";

// In-app changelog. Surfaces what's shipped recently so users
// landing on a familiar surface notice the new affordances they
// might otherwise miss. Pulled from CHANGELOG.md in the repo root
// is the principled approach; for now we hand-curate the highest-
// signal items so the list reads as recommended-reading rather
// than an undifferentiated commit log.
//
// Entries below are reverse-chronological. Each one mentions the
// surface the user can find it on so they can verify by clicking
// through, not just reading.

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, Sparkles } from "lucide-react";

interface Entry {
  date: string; // YYYY-MM-DD
  title: string;
  body: string;
  surface?: string; // e.g. "/app/settings"
}

const ENTRIES: Entry[] = [
  {
    date: "2026-05-08",
    title: "All-wallets activity feed",
    body:
      "New /app/activity page shows every proposal across every wallet you belong to, with wallet + chain + status filters and CSV export. The dashboard's Recent activity now has a 'See all' pill that lands here.",
    surface: "/app/activity",
  },
  {
    date: "2026-05-08",
    title: "Tier-4 security suite",
    body:
      "Per-device PIN lock on /app/* (PBKDF2-hashed locally), canonical-domain phishing tripwire banner, view-only wallet watch list, hardware-wallet auto-detect on /connect (when a paired Ledger is plugged in), and a sign-in security row that opens Dynamic's profile to enroll a passkey.",
    surface: "/app/settings",
  },
  {
    date: "2026-05-07",
    title: "SOL sends actually move SOL",
    body:
      "Two regressions silently bricked SOL transfers — the intent template was missing its accounts/instructions block (silent no-op tx), and the CLI's resolver was passing accounts the on-chain handler auto-injects (AccountAddressMismatch). Both fixed; new test_execute_sol_transfer locks in the path.",
  },
  {
    date: "2026-05-07",
    title: "EVM RPC failover + LE-scalar auto-correct",
    body:
      "Read paths (balance / gas / nonce / eth_call) now retry across PublicNode → BlastAPI → 1RPC → Tenderly → Ankr on network errors and 5xx. The recover_v step also auto-corrects upstream signers that emit little-endian scalars; was previously a hard-fail with no recovery.",
  },
  {
    date: "2026-05-06",
    title: "ERC-20 token sends",
    body:
      "/setup/erc20 enables ERC-20 sending with one spending rule that unlocks every token on Sepolia. /send/erc20 picks the contract per send, fetches decimals + symbol via eth_call, and broadcasts via Ika. Tokens-held panel on the wallet dashboard one-tap fills the contract.",
    surface: "/app/wallet",
  },
  {
    date: "2026-05-06",
    title: "Modern wallet polish",
    body:
      "ENS / SNS resolution in recipient fields, QR scanner via the device camera, recent recipients on EVM send pages, browser notifications when a proposal needs your approval, PWA install prompt + iOS Add-to-Home walkthrough, multi-chain explorer deep links, custom Solana + EVM RPC overrides, Ledger account-index picker.",
    surface: "/app/settings",
  },
  {
    date: "2026-05-05",
    title: "Multisig collaboration",
    body:
      "Member nicknames on /members, approver names + per-approver Approved/Waiting status on the proposal page, threshold-aware progress (was rendering 'X of N approvers' — now uses the actual threshold), Copy-link button on proposals so you can paste them in a group chat. Pending-approvals badge on the Home tab in the bottom nav.",
  },
];

export default function ChangelogPage() {
  const reduce = useReducedMotion();
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  return (
    <main className="relative min-h-screen bg-canvas px-gutter py-12">
      <motion.div
        {...motionProps}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="mx-auto flex max-w-2xl flex-col gap-6"
      >
        <Link
          href="/app/settings"
          className="-ml-2 inline-flex w-fit items-center gap-1.5 rounded-soft px-2 py-1 text-sm text-text-soft hover:text-text-strong"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Settings
        </Link>
        <header>
          <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-accent">
            <Sparkles className="h-3 w-3" strokeWidth={2.25} aria-hidden="true" />
            What&rsquo;s new
          </p>
          <h1 className="mt-2 font-display text-display-sm leading-[1.05] text-text-strong">
            Changelog
          </h1>
          <p className="mt-2 text-sm text-text-soft">
            The shortlist. Bug fixes and tiny polish aren&rsquo;t here —
            those are in the git log.
          </p>
        </header>
        <ul className="flex flex-col gap-4">
          {ENTRIES.map((e, i) => (
            <li
              key={`${e.date}-${i}`}
              className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
                {e.date}
              </p>
              <h2 className="mt-1 font-display text-base font-medium text-text-strong">
                {e.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-text-soft">
                {e.body}
              </p>
              {e.surface && (
                <Link
                  href={e.surface}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-accent-hover"
                >
                  Try it &rsaquo;
                </Link>
              )}
            </li>
          ))}
        </ul>
      </motion.div>
    </main>
  );
}
