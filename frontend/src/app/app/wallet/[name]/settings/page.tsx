"use client";

// Wallet settings — one place to find every per-wallet control.
//
// Used to live as five competing pills in the wallet hub hero
// (Spending rules / Weekly limit / Policy / Chains / Privacy-ready).
// Honest review: three of those pills meant "spending controls" with
// different names, the chains entry was already reachable from the
// chain picker on Send, and the privacy pill was product-marketing
// copy with no per-wallet behaviour.
//
// This page is the consolidation. It lists each control with a
// one-line description and a short status snippet so the user can
// see what's set without drilling in.

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Globe,
  ShieldCheck,
  Wallet as WalletIcon,
} from "lucide-react";
import { useConnection } from "@/lib/wallet";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { IntentType } from "@/lib/msig";
import { toDisplayName, toHeadingName } from "@/lib/retail/walletNames";
import { Breadcrumb } from "@/components/retail/Breadcrumb";
import { StickyTopBar } from "@/components/retail/StickyTopBar";

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

  // Pull the first user intent so we can render a one-line status
  // summary on the "Spending rules" row ("X of Y signers, Z second
  // hold"). Cheap query — already cached if the user came from the
  // hub.
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
      href: `/app/wallet/${encoded}/rules`,
      label: "Spending rules",
      hint: "How many signers approve, and how long sends wait before they ship.",
      Icon: ShieldCheck,
      status: rulesStatus,
    },
    {
      href: `/app/wallet/${encoded}/budget`,
      label: "Spending limit",
      hint: "A weekly cap across every chain. Send refuses to break it.",
      Icon: ShieldCheck,
    },
    {
      href: `/app/wallet/${encoded}/policy`,
      label: "Allowlist & friends",
      hint: "Per-friend caps, time windows, and recipient allowlists.",
      Icon: ShieldCheck,
    },
    {
      href: `/app/wallet/${encoded}/chains`,
      label: "Connected chains",
      hint: "Bind Ethereum, Bitcoin, Zcash. Solana is always on.",
      Icon: Globe,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <StickyTopBar offset="header">
        <Breadcrumb
          segments={[
            { label: "Wallets", href: "/app/wallet" },
            {
              label: display,
              href: `/app/wallet/${encoded}`,
            },
            { label: "Settings" },
          ]}
        />
      </StickyTopBar>

      <motion.section
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center text-center"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
          <WalletIcon className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <h1 className="mt-4 font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          <span className="text-accent">{toHeadingName(name)}</span> settings
        </h1>
        <p className="mt-2 max-w-md text-base text-text-soft">
          Everything per-wallet lives here: rules, limits, allowlists,
          chains. Each section is signed by the wallet's approvers when
          it changes.
        </p>
      </motion.section>

      <ul className="flex flex-col gap-2">
        {items.map((it) => (
          <li key={it.href}>
            <Link
              href={it.href}
              className={
                "group flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest " +
                "transition-[border-color,transform,box-shadow] duration-base ease-out-soft " +
                "hover:-translate-y-0.5 hover:border-accent hover:shadow-card-raised " +
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
                      <span className="mx-1.5 text-text-soft/60">·</span>
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

      <Link
        href={`/app/wallet/${encoded}`}
        className={
          "self-center inline-flex items-center gap-1.5 rounded-soft px-2 py-1 text-sm text-text-soft " +
          "transition-colors duration-base ease-out-soft hover:text-text-strong " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        }
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to {display}
      </Link>
    </div>
  );
}
