"use client";

// Receive money - surface the wallet's funding addresses, one per
// bound chain.
//
// Solana is implicit on every wallet (the program runs there) and the
// vault PDA is derived locally - no backend round-trip needed.
// For Ethereum / Bitcoin / Zcash, the dWallet pubkey gets converted
// to the chain-native format (0x…, bc1q…, t1…) by the CLI on the
// backend and surfaced via `listWalletChains`. This page picks one
// address at a time so the user always copies the right format.
//
// The "no raw addresses on screen by default" rule is deliberately
// broken here - to add money, you need the address.

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection } from "@/lib/wallet";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, Copy, Download } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { findVaultAddress } from "@/lib/msig";
import { CLEAR_WALLET_PROGRAM_ID } from "@/lib/chain/client";
import { ChainBadge } from "@/components/retail/ChainBadge";
import {
  CHAIN_CATALOG,
  chainByKind,
  type ChainMeta,
} from "@/lib/retail/chains";
import { toDisplayName } from "@/lib/retail/walletNames";
import {
  chainAddress,
  useWalletChains,
} from "@/lib/hooks/useWalletChains";
import type { ChainBindingResponse } from "@/lib/api/types";
import { downloadBrandedQr } from "@/lib/retail/qrDownload";
import { useToast } from "@/components/ui/Toast";

interface ReceiveOption {
  chain: ChainMeta;
  address: string | null;
  /// Friendly state label for chains where the dWallet is still
  /// spinning up (no address yet) - never null when address is set.
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
  const toast = useToast();
  const qrRef = useRef<SVGSVGElement | null>(null);
  const [downloading, setDownloading] = useState(false);

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

  // Initial chain selection - honour ?chain=<apiName> deep link so
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

  // If the only bound chain is Solana, no need for the picker - but
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

  // Reset copied state when the user picks a different chain - fresh
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
      /* clipboard blocked - silent */
    }
  };

  const handleDownload = async () => {
    if (!selected?.address || !qrRef.current) return;
    setDownloading(true);
    try {
      await downloadBrandedQr({
        qrSvg: qrRef.current,
        walletName: toDisplayName(name) || "Wallet",
        chainName: selected.chain.name,
        address: selected.address,
        filename: `clear-${toDisplayName(name) || "wallet"}-${selected.chain.apiName}-address`,
      });
      toast.success(`${selected.chain.name} QR downloaded`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't generate the QR image",
      );
    } finally {
      setDownloading(false);
    }
  };

  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };

  return (
    <motion.div
      {...motionProps}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto flex w-full max-w-2xl flex-col gap-6"
    >
      {/* Compact left-aligned header. */}
      <header className="flex flex-col gap-1">
        <h1 className="hidden md:block font-display text-display-xs leading-tight text-text-strong">
          Receive money
        </h1>
        <p className="text-xs text-text-soft sm:text-sm">
          Add funds to{" "}
          <span className="font-medium text-text-strong">
            {toDisplayName(name)}
          </span>
          .{" "}
          {hasMultipleChains
            ? "Pick a chain, then share the address."
            : "Send SOL to the address below."}{" "}
          Anyone with the address can fund the wallet, but only members
          can spend.
        </p>
      </header>

      {/* Chain picker - only when more than just Solana is bound. */}
      {hasMultipleChains && (
        <div
          role="tablist"
          aria-label="Pick a chain to receive on"
          className="flex flex-wrap gap-2"
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
                className={clsx(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium",
                  "transition-[border-color,background-color] duration-base ease-out-soft",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                  active
                    ? "border-accent bg-accent/5 text-text-strong"
                    : "border-border-soft bg-surface-raised text-text-soft hover:text-text-strong",
                )}
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
          <section className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest sm:p-6">
            <div className="flex items-center gap-2">
              <ChainBadge chain={selected.chain} size="sm" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
                {selected.chain.name} address
              </p>
            </div>
            <div className="mt-4 flex justify-center">
              <div className="rounded-soft bg-white p-4 shadow-card-rest">
                <QRCodeSVG
                  key={selected.chain.kind}
                  ref={qrRef}
                  value={selected.address}
                  size={192}
                  level="M"
                  marginSize={0}
                  aria-label={`QR code for ${selected.chain.name} address`}
                />
              </div>
            </div>
            <p
              className="mt-4 break-all rounded-soft border border-border-soft bg-canvas px-3 py-2.5 font-mono text-xs leading-relaxed text-text-strong"
              aria-label={`${selected.chain.name} address: ${selected.address}`}
            >
              {selected.address}
            </p>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={handleCopy}
                aria-label={copied ? "Address copied" : "Copy address"}
                className={clsx(
                  "group flex w-full min-h-tap items-center justify-center gap-2 rounded-soft border bg-canvas px-4 text-sm font-medium",
                  "transition-[border-color,transform,box-shadow,background-color,color] duration-base ease-out-soft active:scale-[0.98]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
                  copied
                    ? "border-accent/40 text-accent"
                    : "border-border-soft text-text-strong hover:-translate-y-0.5 hover:shadow-card-rest",
                )}
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" aria-hidden="true" />
                    Copy address
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleDownload}
                disabled={downloading}
                aria-label="Download QR code as PNG"
                className={clsx(
                  "group flex w-full min-h-tap items-center justify-center gap-2 rounded-soft border border-border-soft bg-canvas px-4 text-sm font-medium text-text-strong",
                  "transition-[border-color,transform,box-shadow] duration-base ease-out-soft active:scale-[0.98]",
                  "hover:-translate-y-0.5 hover:shadow-card-rest",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
                )}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                {downloading ? "Preparing…" : "Download QR"}
              </button>
            </div>
          </section>
        ) : (
          <section className="rounded-card border border-dashed border-border-soft bg-surface-raised p-6 shadow-card-rest">
            <p className="text-sm font-medium text-text-strong">
              Setting up {selected.chain.name}…
            </p>
            <p className="mt-1.5 text-xs text-text-soft">
              The {selected.chain.name} address shows up here once
              the dWallet finishes spinning up. Refresh in a few seconds.
            </p>
          </section>
        )
      ) : (
        <div className="h-64 w-full animate-pulse rounded-card border border-border-soft bg-surface-raised shadow-card-rest" />
      )}

      <p className="text-xs text-text-soft">
        This wallet is on a test network for now. Only send test funds.
      </p>
    </motion.div>
  );
}
