"use client";

// Receive money — surface the wallet's funding addresses, one per
// bound chain.
//
// Solana is implicit on every wallet (the program runs there) and the
// vault PDA is derived locally — no backend round-trip needed.
// For Ethereum / Bitcoin / Zcash, the dWallet pubkey gets converted
// to the chain-native format (0x…, bc1q…, t1…) by the CLI on the
// backend and surfaced via `listWalletChains`. This page picks one
// address at a time so the user always copies the right format.
//
// The "no raw addresses on screen by default" rule is deliberately
// broken here — to add money, you need the address.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection } from "@/lib/wallet";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, Copy, Wallet } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { findVaultAddress } from "@/lib/msig";
import { CLEAR_WALLET_PROGRAM_ID } from "@/lib/chain/client";
import { Breadcrumb } from "@/components/retail/Breadcrumb";
import { StickyTopBar } from "@/components/retail/StickyTopBar";
import { Button } from "@/components/retail/Button";
import { ChainBadge } from "@/components/retail/ChainBadge";
import {
  CHAIN_CATALOG,
  chainByKind,
  type ChainMeta,
} from "@/lib/retail/chains";
import { toDisplayName, toHeadingName } from "@/lib/retail/walletNames";
import {
  chainAddress,
  useWalletChains,
} from "@/lib/hooks/useWalletChains";
import type { ChainBindingResponse } from "@/lib/api/types";

interface ReceiveOption {
  chain: ChainMeta;
  address: string | null;
  /// Friendly state label for chains where the dWallet is still
  /// spinning up (no address yet) — never null when address is set.
  pending?: boolean;
}

export default function ReceivePage() {
  const params = useParams<{ name: string }>();
  const name = useMemo(() => {
    try {
      return decodeURIComponent(params?.name ?? "");
    } catch {
      return params?.name ?? "";
    }
  }, [params?.name]);

  const reduce = useReducedMotion();
  const { connection } = useConnection();

  // Solana side: derive the vault PDA locally from the wallet name.
  const walletQuery = useQuery({
    queryKey: ["wallet", name],
    queryFn: () => fetchWalletByName(connection, name),
    enabled: name.length > 0,
    staleTime: 30_000,
  });
  const solanaAddress = useMemo(() => {
    if (!walletQuery.data) return null;
    const [vault] = findVaultAddress(
      walletQuery.data.pda,
      CLEAR_WALLET_PROGRAM_ID,
    );
    return vault.toBase58();
  }, [walletQuery.data]);

  // Other chains: backend returns the chain-native address per
  // binding. Hidden until at least one non-Solana chain is bound.
  const chainsQuery = useWalletChains(name);

  const options: ReceiveOption[] = useMemo(() => {
    const out: ReceiveOption[] = [];
    // Solana is always first.
    const solanaMeta = chainByKind(0);
    if (solanaMeta) {
      out.push({ chain: solanaMeta, address: solanaAddress });
    }
    // Other bindings come from the backend response.
    const bindings: ChainBindingResponse[] = chainsQuery.data?.chains ?? [];
    for (const b of bindings) {
      if (b.chain_kind === 0) continue; // already covered by the local derivation
      const meta = chainByKind(b.chain_kind);
      if (!meta) continue;
      const addr = chainAddress(b);
      out.push({
        chain: meta,
        address: addr,
        pending: addr === null,
      });
    }
    return out;
  }, [solanaAddress, chainsQuery.data]);

  // Initial chain selection — honour ?chain=<apiName> deep link so
  // the chains-list "QR" button can jump straight to the right
  // address on /receive without an extra tap.
  const search = useSearchParams();
  const initialKind = useMemo(() => {
    const want = search?.get("chain");
    if (!want) return 0;
    const meta = CHAIN_CATALOG.find(
      (c) => c.apiName.toLowerCase() === want.toLowerCase(),
    );
    return meta?.kind ?? 0;
  }, [search]);
  const [selectedKind, setSelectedKind] = useState<number>(initialKind);

  // If the only bound chain is Solana, no need for the picker — but
  // we still render the option so the page works for the common case.
  // When non-Solana chains are added, the picker appears at the top.
  const hasMultipleChains = options.length > 1;

  const selected = options.find((o) => o.chain.kind === selectedKind) ?? options[0];

  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  // Reset copied state when the user picks a different chain — fresh
  // address, fresh "Copy" affordance.
  useEffect(() => {
    setCopied(false);
  }, [selectedKind]);

  const handleCopy = async () => {
    if (!selected?.address) return;
    try {
      await navigator.clipboard.writeText(selected.address);
      setCopied(true);
    } catch {
      /* clipboard blocked — silent */
    }
  };

  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };

  return (
    <main className="relative flex min-h-screen flex-col bg-canvas">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -left-32 -top-16 h-[55vh] w-[80vw] max-w-[640px] rounded-full bg-accent/[0.06] blur-3xl" />
      </div>

      <StickyTopBar offset="header">
        <Breadcrumb
          segments={[
            { label: "Wallets", href: "/app/wallet" },
            { label: toDisplayName(name), href: `/app/wallet/${encodeURIComponent(name)}` },
            { label: "Receive" },
          ]}
        />
      </StickyTopBar>

      <div className="relative z-10 flex flex-1 items-center justify-center px-gutter py-10">
        <motion.section
          {...motionProps}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-md"
        >
          <div className="flex flex-col items-center text-center">
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-accent">
              <Wallet className="h-7 w-7" strokeWidth={1.75} />
            </div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-text-soft">
              Receive money
            </p>
            <h1 className="mt-2 font-display text-display-sm leading-[1.05] text-text-strong text-balance">
              Add money to <span className="text-accent">{toHeadingName(name)}</span>
            </h1>
            <p className="mt-3 max-w-sm text-base text-text-soft">
              {hasMultipleChains
                ? "Pick a chain, then share the address. Anyone with it can fund the wallet. Only members can spend."
                : "Send SOL to the address below. Anyone with the address can fund the wallet, but only members can spend from it."}
            </p>

            {/* Chain picker — only when we have more than just Solana. */}
            {hasMultipleChains && (
              <div
                role="tablist"
                aria-label="Pick a chain to receive on"
                className="mt-6 flex w-full flex-wrap justify-center gap-2"
              >
                {options.map((opt) => {
                  const active = opt.chain.kind === selected?.chain.kind;
                  return (
                    <button
                      key={opt.chain.kind}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setSelectedKind(opt.chain.kind)}
                      className={
                        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium " +
                        "transition-[border-color,background-color,transform] duration-base ease-out-soft " +
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas " +
                        (active
                          ? "border-accent bg-accent/5 text-text-strong"
                          : "border-border-soft bg-surface-raised text-text-soft hover:border-accent/40 hover:text-text-strong")
                      }
                    >
                      <ChainBadge chain={opt.chain} size="sm" />
                      {opt.chain.name}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Address card. */}
            {selected ? (
              selected.address ? (
                <div className="mt-8 w-full rounded-card border border-border-soft bg-surface-raised p-5 text-left shadow-card-rest">
                  <div className="flex items-center gap-2">
                    <ChainBadge chain={selected.chain} size="sm" />
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-text-soft">
                      {selected.chain.name} address
                    </p>
                  </div>
                  {/* QR code so the user can scan from a sender's
                      mobile wallet instead of copy-pasting the
                      address. Pure SVG render, no external service
                      (so the address never leaves this page). The
                      key forces a remount when the chain changes —
                      otherwise React preserves the SVG and the
                      payload-to-DOM diff produces a momentary
                      malformed code on switch. */}
                  <div className="mt-3 flex justify-center">
                    <div className="rounded-soft bg-white p-3 shadow-card-rest">
                      <QRCodeSVG
                        key={selected.chain.kind}
                        value={selected.address}
                        size={176}
                        level="M"
                        marginSize={0}
                        aria-label={`QR code for ${selected.chain.name} address`}
                      />
                    </div>
                  </div>
                  <p
                    className="mt-3 break-all font-mono text-sm leading-relaxed text-text-strong"
                    aria-label={`${selected.chain.name} address: ${selected.address}`}
                  >
                    {selected.address}
                  </p>
                  <button
                    type="button"
                    onClick={handleCopy}
                    aria-label={copied ? "Address copied" : "Copy address"}
                    className={
                      "group mt-4 flex w-full items-center justify-center gap-2 rounded-soft border border-border-soft bg-canvas " +
                      "min-h-tap px-4 text-sm font-medium text-text-strong " +
                      "transition-[border-color,transform,box-shadow] duration-base ease-out-soft " +
                      "hover:-translate-y-0.5 hover:border-accent hover:shadow-card-rest active:scale-[0.98] " +
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                    }
                  >
                    {copied ? (
                      <>
                        <Check
                          className="h-4 w-4 text-accent"
                          strokeWidth={3}
                          aria-hidden="true"
                        />
                        <span className="text-accent">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4" aria-hidden="true" />
                        Copy address
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <div className="mt-8 w-full rounded-card border border-dashed border-border-soft bg-surface-raised p-5 text-left shadow-card-rest">
                  <p className="font-display text-base text-text-strong">
                    Setting up {selected.chain.name}…
                  </p>
                  <p className="mt-1.5 text-sm text-text-soft">
                    The {selected.chain.name} address shows up here once
                    the dWallet finishes spinning up. Refresh in a few
                    seconds.
                  </p>
                </div>
              )
            ) : (
              <div className="mt-8 h-44 w-full animate-pulse rounded-card border border-border-soft bg-surface-raised shadow-card-rest" />
            )}

            <p className="mt-4 max-w-sm text-xs text-text-soft">
              Sending money you can&rsquo;t afford to lose? Don&rsquo;t.
              This wallet is on a test network for now. Only send test
              funds.
            </p>

            <Link
              href={`/app/wallet/${encodeURIComponent(name)}`}
              className="mt-6 inline-block w-full"
            >
              <Button size="lg" variant="secondary" fullWidth>
                Back to {toDisplayName(name)}
              </Button>
            </Link>
          </div>
        </motion.section>
      </div>
    </main>
  );
}
