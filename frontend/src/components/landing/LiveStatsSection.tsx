"use client";

// Live on-chain stats. Queries Solana devnet directly for wallet,
// proposal, and IkaConfig account counts. Each number animates from
// zero up to the real value the moment the card scrolls into view.
//
// Stays static on every screen size. Three cards sit side by side
// because the counters are compact at a glance. Every measurement
// uses the shared Phase 6 card tokens so the proportions match every
// other landing card exactly.

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ShieldCheck,
  Wallet,
  Link as LinkIcon,
  type LucideIcon,
} from "lucide-react";
import { getConnection, CLEAR_WALLET_PROGRAM_ID } from "@/lib/chain/client";
import {
  DISC_CLEAR_WALLET,
  DISC_IKA_CONFIG,
  DISC_PROPOSAL,
} from "@/lib/msig";
import { CARD, SECTION } from "@/components/landing/cardTokens";

interface Stat {
  label: string;
  Icon: LucideIcon;
  value: number | null;
}

async function countAccountsByDisc(disc: number): Promise<number> {
  const connection = getConnection();
  const accounts = await connection.getProgramAccounts(CLEAR_WALLET_PROGRAM_ID, {
    commitment: "confirmed",
    filters: [{ memcmp: { offset: 0, bytes: base58OfByte(disc) } }],
    dataSlice: { offset: 0, length: 0 },
  });
  return accounts.length;
}

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58OfByte(b: number): string {
  if (b === 0) return "1";
  let n = BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58_ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  return out;
}

export function LiveStatsSection() {
  const walletsQuery = useQuery({
    queryKey: ["landing-stat", "wallets"],
    queryFn: () => countAccountsByDisc(DISC_CLEAR_WALLET),
    refetchInterval: 30_000,
    retry: 1,
  });

  const proposalsQuery = useQuery({
    queryKey: ["landing-stat", "proposals"],
    queryFn: () => countAccountsByDisc(DISC_PROPOSAL),
    refetchInterval: 30_000,
    retry: 1,
  });

  const chainsQuery = useQuery({
    queryKey: ["landing-stat", "chains"],
    queryFn: () => countAccountsByDisc(DISC_IKA_CONFIG),
    refetchInterval: 30_000,
    retry: 1,
  });

  const stats: Stat[] = useMemo(
    () => [
      { label: "Multisigs deployed", Icon: Wallet, value: walletsQuery.data ?? null },
      { label: "Proposals signed", Icon: ShieldCheck, value: proposalsQuery.data ?? null },
      { label: "Chain dWallets bound", Icon: LinkIcon, value: chainsQuery.data ?? null },
    ],
    [walletsQuery.data, proposalsQuery.data, chainsQuery.data]
  );

  return (
    <section id="stats" className="w-full">
      <div className="mx-auto max-w-3xl text-center">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full bg-black/5 px-3 py-1 ${SECTION.eyebrow} font-bold uppercase tracking-widest text-black/70`}
        >
          <Activity className="h-3 w-3" /> Live on devnet
        </span>
        <h2 className={`mt-3 font-display ${SECTION.title} font-bold leading-[1.05] tracking-tight text-black text-balance`}>
          Running on real chain, not a slide.
        </h2>
        <p className={`mt-2 ${SECTION.body} text-black/60`}>
          These numbers come from a direct{" "}
          <code className={`rounded bg-black/5 px-1.5 py-0.5 font-mono ${CARD.body}`}>
            getProgramAccounts
          </code>{" "}
          call against Solana devnet. Refreshed every 30 seconds.
        </p>
      </div>

      <div className="mt-8 grid grid-cols-3 gap-[clamp(0.375rem,1.2vw,1.25rem)] sm:mt-10">
        {stats.map((s, i) => (
          <StatCard key={s.label} index={i} stat={s} />
        ))}
      </div>
    </section>
  );
}

// StatCard uses a tighter clamp profile than the generic CARD tokens
// so that three of them comfortably fit the width of a 320-414px
// phone. At lg+ widths it still scales back up to match the rest of
// the landing cards.
function StatCard({ stat, index }: { stat: Stat; index: number }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const inView = useInView(cardRef, { once: true, margin: "-120px 0px" });

  return (
    <motion.div
      ref={cardRef}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.45, delay: index * 0.1 }}
      className={`group relative min-w-0 overflow-hidden ${CARD.radius} border border-black/10 bg-white/85 p-[clamp(0.5rem,1.1vw,1.25rem)] shadow-card-shadow backdrop-blur`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-brand-green/10 blur-3xl transition-opacity group-hover:opacity-80"
      />
      <div className="relative z-10 flex items-start justify-between gap-1">
        <span className="flex items-center justify-center h-[clamp(1.5rem,2.4vw,2.5rem)] w-[clamp(1.5rem,2.4vw,2.5rem)] rounded-[clamp(0.375rem,0.9vw,0.75rem)] bg-black text-brand-green">
          <stat.Icon className="h-[clamp(0.75rem,1.2vw,1.125rem)] w-[clamp(0.75rem,1.2vw,1.125rem)]" />
        </span>
        <span className={`shrink-0 ${CARD.mono} font-bold uppercase tracking-widest text-black/40`}>
          devnet
        </span>
      </div>
      <div className="relative z-10 mt-[clamp(0.4rem,0.9vw,1rem)] flex items-baseline gap-1">
        <span className="font-display text-[clamp(1.125rem,3.4vw,3rem)] font-bold leading-none tracking-ultra-tight text-black tabular-nums">
          {stat.value === null ? "·" : <CountUp target={stat.value} start={inView} />}
        </span>
        <span className="h-[clamp(0.25rem,0.4vw,0.5rem)] w-[clamp(0.25rem,0.4vw,0.5rem)] animate-pulse rounded-full bg-brand-green" />
      </div>
      <p className={`relative z-10 mt-1 ${CARD.body} font-semibold text-black/70 break-words`}>
        {stat.label}
      </p>
    </motion.div>
  );
}

// CountUp. Starts at 0 the first time `start` flips true, then eases
// to `target` over about 1.4s using a cubic easeOut curve.
function CountUp({ target, start }: { target: number; start: boolean }) {
  const [value, setValue] = useState(0);
  const hasStartedRef = useRef(false);
  const lastTargetRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!start) return;
    const from = hasStartedRef.current ? lastTargetRef.current : 0;
    const to = target;
    if (from === to) {
      setValue(to);
      lastTargetRef.current = to;
      hasStartedRef.current = true;
      return;
    }
    const duration = hasStartedRef.current ? 600 : 1400;
    const started = performance.now();

    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(from + (to - from) * eased));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        lastTargetRef.current = to;
        hasStartedRef.current = true;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [start, target]);

  return <>{value.toLocaleString()}</>;
}
