"use client";

// Wallet settings - low-frequency wallet administration.
//
// Policy is the canonical money-control flow. Settings now points
// there instead of duplicating rules, budget, and allowlist controls
// under different names.

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Bot,
  Globe,
  ShieldCheck,
  Wallet as WalletIcon,
} from "lucide-react";
import { useConnection } from "@/lib/wallet";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { IntentType } from "@/lib/msig";
import { toDisplayName } from "@/lib/retail/walletNames";

interface SettingItem {
  href: string;
  label: string;
  hint: string;
  Icon: typeof ShieldCheck;
  status?: string;
}

export default function WalletSettingsPage() {
  const params = useParams<{ name: string }>();
  const name = useMemo(() => {
    const raw = params?.name ?? "";
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }, [params?.name]);
  const display = toDisplayName(name);
  const reduce = useReducedMotion();
  const { connection } = useConnection();
  const encoded = encodeURIComponent(name);

  // Pull the first user intent so we can render a one-line approval
  // status on the policy row. Cheap query - already cached if the
  // user came from the hub.
  const walletQuery = useQuery({
    queryKey: ["wallet", name],
    queryFn: () => fetchWalletByName(connection, name),
    enabled: name.length > 0,
    staleTime: 30_000,
  });
  const intentsQuery = useQuery({
    queryKey: ["wallet-intents", walletQuery.data?.pda.toBase58() ?? null],
    queryFn: async () => {
      if (!walletQuery.data) return [];
      const upTo = walletQuery.data.account.intentIndex;
      return listIntents(connection, walletQuery.data.pda, upTo);
    },
    enabled: !!walletQuery.data,
    staleTime: 30_000,
  });
  const firstIntent = useMemo(() => {
    if (!intentsQuery.data) return null;
    return (
      intentsQuery.data.find(
        (it) => it.account !== null && it.account.intentType === IntentType.Custom,
      ) ?? null
    );
  }, [intentsQuery.data]);

  const rulesStatus = useMemo(() => {
    const acc = firstIntent?.account;
    if (!acc) return undefined;
    const t = acc.approvalThreshold;
    const total = acc.approvers.length;
    const cool = acc.timelockSeconds;
    const coolBit = cool > 0 ? `, ${Math.round(cool / 3600)}h hold` : "";
    return `${t} of ${total} signers${coolBit}`;
  }, [firstIntent]);

  const items: SettingItem[] = [
    {
      href: `/app/wallet/${encoded}/policy`,
      label: "Rules and limits",
      hint: "Members, approvals, spending limits, and safety checks.",
      Icon: ShieldCheck,
      status: rulesStatus,
    },
    {
      href: `/app/wallet/${encoded}/agents`,
      label: "Agent Trading",
      hint: "Register trading agents, review trade signals, and control risk limits.",
      Icon: Bot,
    },
    {
      href: `/app/wallet/${encoded}/chains`,
      label: "Connected chains",
      hint: "Bind Ethereum, Hyperliquid, Bitcoin, Zcash. Solana is always on.",
      Icon: Globe,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Page header strip - mono eyebrow + display title, identity
          anchored by the wallet icon disc. Back navigation lives on
          the global header bar (mobile + desktop), so no inline
          breadcrumb / back chip on this page. */}
      <motion.header
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4"
      >
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden="true"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent sm:h-14 sm:w-14"
          >
            <WalletIcon className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={1.75} />
          </span>
          <div className="flex min-w-0 flex-col">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
              Settings · {display}
            </p>
            <h1 className="mt-1.5 truncate font-display text-2xl leading-[1.05] tracking-[-0.02em] text-text-strong sm:text-display-sm">
              Wallet controls
            </h1>
          </div>
        </div>
      </motion.header>

      <p className="max-w-2xl text-sm text-text-soft sm:text-base">
        Wallet settings are for setup. Money controls live in one rules area
        so members do not have to hunt across pages.
      </p>

      <ul className="flex flex-col gap-2">
        {items.map((it) => (
          <li key={it.href}>
            <Link
              href={it.href}
              className={
                "group flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest " +
                "transition-[border-color,transform,box-shadow] duration-base ease-out-soft " +
                "hover:-translate-y-0.5 hover:shadow-card-raised " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              }
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                <it.Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text-strong">
                  {it.label}
                </p>
                <p className="mt-0.5 truncate text-xs text-text-soft">
                  {it.status ? (
                    <>
                      <span className="text-text-strong">{it.status}</span>
                      <span aria-hidden="true" className="mx-1.5 text-text-soft">·</span>
                      {it.hint}
                    </>
                  ) : (
                    it.hint
                  )}
                </p>
              </div>
              <ArrowRight
                className="h-4 w-4 shrink-0 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-accent"
                aria-hidden="true"
              />
            </Link>
          </li>
        ))}
      </ul>

    </div>
  );
}
