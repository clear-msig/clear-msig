"use client";

// Typed intent creation flow . Phase 5.5.
//
// UX:
//   1. User picks a canonical intent template from the catalog (SOL
//      transfer, ETH 1559, ERC-20, BTC P2WPKH, Zcash transparent, SPL).
//   2. Configures the multisig policy (approvers, proposers, threshold,
//      cancellation threshold, timelock) . defaults to "signer only".
//   3. On submit: POST `/prepare/.../intents/add` → get a
//      `DryRunDescriptor` with the exact bytes to sign → wallet
//      `signMessage` → POST the signed envelope to the submit route.
//   4. Live "what you'll sign" preview (Human-readable | Signed bytes).
//
// Three modes in one card . Add / Update / Remove. Update reuses the Add
// form with an extra intent-index slot; Remove is a lean index-only panel.
// All three ride the same prepare → sign → submit rails.

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronRight,
  Coins,
  Bitcoin,
  Leaf,
  Loader2,
  Minus,
  Pencil,
  PlusCircle,
  ShieldCheck,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CardShell } from "@/components/ui/CardShell";
import { SignablePreview } from "@/components/proposals/SignablePreview";
import { useIntentWorkflow } from "@/lib/hooks/useIntentWorkflow";
import { useSignWithWallet, WalletSignError } from "@/lib/hooks/useSignWithWallet";
import { useWalletGate } from "@/lib/hooks/useWalletGate";
import { useToast } from "@/components/ui/Toast";
import { fromHex, unwrapOffchain } from "@/lib/msig";
import { backendApi } from "@/lib/api/endpoints";
import { appConfig } from "@/lib/config";
import type {
  DryRunDescriptor,
  PrepareAddIntentInput,
  PrepareUpdateIntentInput,
} from "@/lib/api/types";

type Mode = "add" | "update" | "remove";

interface TemplateCatalogEntry {
  id: string;
  label: string;
  chainLabel: string;
  chainTone: "solana" | "evm" | "btc" | "zec" | "spl";
  path: string;
  blurb: string;
  Icon: LucideIcon;
}

const TEMPLATE_CATALOG: TemplateCatalogEntry[] = [
  {
    id: "sol",
    label: "Transfer SOL",
    chainLabel: "Solana",
    chainTone: "solana",
    path: "examples/intents/solana_transfer.json",
    blurb: "Send native SOL from the vault PDA to any address.",
    Icon: Zap,
  },
  {
    id: "spl",
    label: "Transfer SPL Token",
    chainLabel: "Solana · SPL",
    chainTone: "spl",
    path: "examples/intents/transfer_tokens.json",
    blurb: "Transfer an SPL token using the vault's associated token account.",
    Icon: Coins,
  },
  {
    id: "eth",
    label: "Transfer ETH",
    chainLabel: "Ethereum · EIP-1559",
    chainTone: "evm",
    path: "examples/intents/evm_transfer.json",
    blurb: "Native ETH transfer with EIP-1559 gas fields.",
    Icon: Zap,
  },
  {
    id: "erc20",
    label: "Transfer ERC-20",
    chainLabel: "Ethereum · ERC-20",
    chainTone: "evm",
    path: "examples/intents/erc20_transfer.json",
    blurb: "ERC-20 `transfer(to, amount)` call with EIP-1559 fees.",
    Icon: Coins,
  },
  {
    id: "btc",
    label: "Transfer BTC",
    chainLabel: "Bitcoin · P2WPKH",
    chainTone: "btc",
    path: "examples/intents/btc_transfer.json",
    blurb: "BIP143-signed SegWit transfer from a single UTXO.",
    Icon: Bitcoin,
  },
  {
    id: "zec",
    label: "Transfer Zcash",
    chainLabel: "Zcash · transparent",
    chainTone: "zec",
    path: "examples/intents/zcash_transfer.json",
    blurb: "ZIP-243-signed transparent send.",
    Icon: Leaf,
  },
];

export function IntentCard() {
  const toast = useToast();
  const gate = useWalletGate();
  const { signBytes, canSign } = useSignWithWallet();

  const [walletName, setWalletName] = useState(appConfig.defaultWalletName);
  const [mode, setMode] = useState<Mode>("add");
  const workflow = useIntentWorkflow(walletName);

  return (
    <CardShell
      title="Create Intent"
      subtitle="Add, update, or remove a governance rule on your multisig"
    >
      <motion.div
        className="flex flex-col gap-5"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <LabelledField label="Wallet">
            <input
              value={walletName}
              onChange={(e) => setWalletName(e.target.value)}
              placeholder="treasury"
              spellCheck={false}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-brand-white outline-none transition-colors focus:border-brand-green/50 focus:bg-white/10"
            />
          </LabelledField>
          <LabelledField label="Mode">
            <ModeSegmented mode={mode} onChange={setMode} />
          </LabelledField>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {mode === "add" && (
            <motion.div
              key="add"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
            >
              <AddOrUpdatePanel
                mode="add"
                walletName={walletName}
                connectedPubkey={gate.publicKey}
                canSign={canSign}
                signBytes={signBytes}
                onSubmitted={() => workflow.listQuery.refetch()}
                toast={toast}
              />
            </motion.div>
          )}
          {mode === "update" && (
            <motion.div
              key="update"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
            >
              <AddOrUpdatePanel
                mode="update"
                walletName={walletName}
                connectedPubkey={gate.publicKey}
                canSign={canSign}
                signBytes={signBytes}
                onSubmitted={() => workflow.listQuery.refetch()}
                toast={toast}
              />
            </motion.div>
          )}
          {mode === "remove" && (
            <motion.div
              key="remove"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
            >
              <RemovePanel
                walletName={walletName}
                canSign={canSign}
                signBytes={signBytes}
                onSubmitted={() => workflow.listQuery.refetch()}
                toast={toast}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </CardShell>
  );
}

// ── mode pill ─────────────────────────────────────────────────────────

function ModeSegmented({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const items: { id: Mode; label: string; Icon: LucideIcon }[] = [
    { id: "add", label: "Add", Icon: PlusCircle },
    { id: "update", label: "Update", Icon: Pencil },
    { id: "remove", label: "Remove", Icon: Trash2 },
  ];
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
      {items.map((it) => {
        const active = mode === it.id;
        return (
          <button
            key={it.id}
            onClick={() => onChange(it.id)}
            className={[
              "relative inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
              active ? "text-black" : "text-white/60 hover:text-white",
            ].join(" ")}
          >
            {active && (
              <motion.span
                layoutId="intent-mode-pill"
                className="absolute inset-0 rounded-lg bg-brand-green"
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
              />
            )}
            <it.Icon size={13} className="relative z-10" />
            <span className="relative z-10">{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Add / Update shared panel ─────────────────────────────────────────

type Toaster = ReturnType<typeof useToast>;

interface AddOrUpdateProps {
  mode: "add" | "update";
  walletName: string;
  connectedPubkey: string | null;
  canSign: boolean;
  signBytes: ReturnType<typeof useSignWithWallet>["signBytes"];
  onSubmitted: () => unknown;
  toast: Toaster;
}

function AddOrUpdatePanel({
  mode,
  walletName,
  connectedPubkey,
  canSign,
  signBytes,
  onSubmitted,
  toast,
}: AddOrUpdateProps) {
  const [templateId, setTemplateId] = useState<string>(TEMPLATE_CATALOG[0].id);
  const [proposers, setProposers] = useState<string[]>([]);
  const [approvers, setApprovers] = useState<string[]>([]);
  const [threshold, setThreshold] = useState("1");
  const [cancellationThreshold, setCancellationThreshold] = useState("1");
  const [timelock, setTimelock] = useState("0");
  const [expiry, setExpiry] = useState("");
  const [updateIndex, setUpdateIndex] = useState("3");

  const [descriptor, setDescriptor] = useState<DryRunDescriptor | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [signing, setSigning] = useState(false);

  const template = useMemo(
    () => TEMPLATE_CATALOG.find((t) => t.id === templateId) ?? TEMPLATE_CATALOG[0],
    [templateId]
  );

  // Reset stale preview when inputs change.
  useEffect(() => {
    setDescriptor(null);
  }, [
    mode,
    walletName,
    templateId,
    proposers,
    approvers,
    threshold,
    cancellationThreshold,
    timelock,
    expiry,
    updateIndex,
  ]);

  const resolvedProposers = proposers.length > 0 ? proposers : connectedPubkey ? [connectedPubkey] : [];
  const resolvedApprovers = approvers.length > 0 ? approvers : connectedPubkey ? [connectedPubkey] : [];

  const thresholdNum = Number(threshold);
  const valid =
    walletName.trim().length > 0 &&
    resolvedProposers.length > 0 &&
    resolvedApprovers.length > 0 &&
    Number.isFinite(thresholdNum) &&
    thresholdNum >= 1 &&
    thresholdNum <= resolvedApprovers.length &&
    (mode === "add" || Number(updateIndex) >= 3);

  const preview = useMemo(() => descriptorToPreview(descriptor), [descriptor]);

  const buildPreparePayload = (): PrepareAddIntentInput | PrepareUpdateIntentInput => {
    const base: PrepareAddIntentInput = {
      file: template.path,
      proposers: resolvedProposers,
      approvers: resolvedApprovers,
      threshold: thresholdNum,
      cancellation_threshold: Number(cancellationThreshold),
      timelock: Number(timelock),
    };
    if (expiry.trim()) base.expiry = expiry.trim();
    if (mode === "update") {
      return { ...base, index: Number(updateIndex) } as PrepareUpdateIntentInput;
    }
    return base;
  };

  const submit = async () => {
    if (!valid) return;
    try {
      setPreparing(true);
      const payload = buildPreparePayload();
      const desc =
        mode === "add"
          ? await backendApi.prepare.addIntent(walletName, payload as PrepareAddIntentInput)
          : await backendApi.prepare.updateIntent(walletName, payload as PrepareUpdateIntentInput);
      setDescriptor(desc);
      setPreparing(false);

      setSigning(true);
      const { signer_pubkey, signature } = await signBytes(fromHex(desc.message_hex));

      const res =
        mode === "add"
          ? await backendApi.submit.addIntent(walletName, {
              file: template.path,
              signer_pubkey,
              signature,
              params_data_hex: desc.params_data_hex,
              expiry: desc.expiry,
            })
          : await backendApi.submit.updateIntent(walletName, {
              index: Number(updateIndex),
              file: template.path,
              signer_pubkey,
              signature,
              params_data_hex: desc.params_data_hex,
              expiry: desc.expiry,
            });

      toast.success(
        mode === "add" ? "Intent added" : "Intent updated",
        {
          link: explorerLink(res),
          details:
            mode === "add"
              ? "Your multisig can now propose transactions against this intent."
              : "The intent definition has been rotated in place.",
        }
      );
      await onSubmitted();
    } catch (err) {
      if (err instanceof WalletSignError) {
        toast.error(
          err.code === "rejected" ? "Wallet rejected the signature" : err.message
        );
      } else {
        toast.error(
          err instanceof Error ? err.message : "Submit failed, see details",
          { details: describeError(err) }
        );
      }
    } finally {
      setPreparing(false);
      setSigning(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Template catalog. */}
      <div>
        <SectionLabel>Template</SectionLabel>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {TEMPLATE_CATALOG.map((t) => (
            <TemplateTile
              key={t.id}
              template={t}
              selected={t.id === templateId}
              onSelect={() => setTemplateId(t.id)}
            />
          ))}
        </div>
      </div>

      {/* Policy. */}
      <div className="grid gap-4 md:grid-cols-2">
        <AddressChipInput
          label="Approvers"
          hint="Addresses allowed to sign this intent's proposals. Defaults to you."
          values={approvers}
          onChange={setApprovers}
          placeholder="Base58 pubkey, press Enter to add"
          fallbackPreview={connectedPubkey ? `you · ${shortAddr(connectedPubkey)}` : undefined}
        />
        <AddressChipInput
          label="Proposers"
          hint="Addresses allowed to open proposals. Usually a subset of approvers."
          values={proposers}
          onChange={setProposers}
          placeholder="Base58 pubkey, press Enter to add"
          fallbackPreview={connectedPubkey ? `you · ${shortAddr(connectedPubkey)}` : undefined}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <LabelledField label="Approval threshold">
          <NumberInput value={threshold} onChange={setThreshold} min={1} />
          <Hint>
            Signatures needed to execute · {thresholdNum || "?"} of{" "}
            {resolvedApprovers.length || "?"}
          </Hint>
        </LabelledField>
        <LabelledField label="Cancellation threshold">
          <NumberInput value={cancellationThreshold} onChange={setCancellationThreshold} min={1} />
          <Hint>Approvers needed to veto.</Hint>
        </LabelledField>
        <LabelledField label="Timelock (seconds)">
          <NumberInput value={timelock} onChange={setTimelock} min={0} />
          <Hint>Minimum delay between approval and execution.</Hint>
        </LabelledField>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <LabelledField label="Signature expiry (optional)">
          <input
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            placeholder="YYYY-MM-DD HH:MM:SS (UTC)"
            spellCheck={false}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-brand-white outline-none transition-colors focus:border-brand-green/50 focus:bg-white/10"
          />
          <Hint>Leave blank for the default 5-minute window.</Hint>
        </LabelledField>
        {mode === "update" && (
          <LabelledField label="Intent index to replace">
            <NumberInput value={updateIndex} onChange={setUpdateIndex} min={3} />
            <Hint>Indexes 0-2 are reserved for meta-intents.</Hint>
          </LabelledField>
        )}
      </div>

      {/* Live preview (populated after /prepare succeeds). */}
      <SignablePreview
        bodyText={preview?.bodyText ?? null}
        messageHex={preview?.hex ?? null}
        statusChip={
          preparing ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/70">
              <Loader2 size={10} className="animate-spin" /> computing
            </span>
          ) : !descriptor ? (
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/40">
              fill form
            </span>
          ) : null
        }
      />

      {/* Submit. */}
      <div className="flex flex-col gap-1.5">
        <button
          disabled={!valid || preparing || signing || !canSign}
          onClick={submit}
          className="group relative inline-flex items-center justify-center gap-2 rounded-2xl bg-brand-green px-5 py-3.5 text-sm font-bold text-black shadow-glow transition-all hover:bg-emerald-300 hover:shadow-glow-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {preparing ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Building message…
            </>
          ) : signing ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Signing & relaying…
            </>
          ) : (
            <>
              <ShieldCheck size={16} />
              {mode === "add" ? "Sign & add intent" : "Sign & update intent"}
              <ChevronRight
                size={16}
                className="transition-transform group-hover:translate-x-0.5"
              />
            </>
          )}
        </button>
        {!canSign && (
          <span className="text-xs text-text-muted">
            Connect a wallet that supports signMessage (Phantom, Solflare, Backpack).
          </span>
        )}
      </div>
    </div>
  );
}

// ── Remove panel ──────────────────────────────────────────────────────

interface RemoveProps {
  walletName: string;
  canSign: boolean;
  signBytes: ReturnType<typeof useSignWithWallet>["signBytes"];
  onSubmitted: () => unknown;
  toast: Toaster;
}

function RemovePanel({ walletName, canSign, signBytes, onSubmitted, toast }: RemoveProps) {
  const [index, setIndex] = useState("3");
  const [expiry, setExpiry] = useState("");
  const [descriptor, setDescriptor] = useState<DryRunDescriptor | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [signing, setSigning] = useState(false);

  useEffect(() => {
    setDescriptor(null);
  }, [walletName, index, expiry]);

  const indexNum = Number(index);
  const valid = walletName.trim().length > 0 && Number.isFinite(indexNum) && indexNum >= 3;
  const preview = useMemo(() => descriptorToPreview(descriptor), [descriptor]);

  const submit = async () => {
    if (!valid) return;
    try {
      setPreparing(true);
      const desc = await backendApi.prepare.removeIntent(walletName, {
        index: indexNum,
        ...(expiry.trim() ? { expiry: expiry.trim() } : {}),
      });
      setDescriptor(desc);
      setPreparing(false);

      setSigning(true);
      const { signer_pubkey, signature } = await signBytes(fromHex(desc.message_hex));
      const res = await backendApi.submit.removeIntent(walletName, {
        index: indexNum,
        signer_pubkey,
        signature,
        params_data_hex: desc.params_data_hex,
        expiry: desc.expiry,
      });
      toast.success("Intent removed", {
        link: explorerLink(res),
        details: "The slot is freed and can be reused by a future AddIntent.",
      });
      await onSubmitted();
    } catch (err) {
      if (err instanceof WalletSignError) {
        toast.error(
          err.code === "rejected" ? "Wallet rejected the signature" : err.message
        );
      } else {
        toast.error(
          err instanceof Error ? err.message : "Submit failed, see details",
          { details: describeError(err) }
        );
      }
    } finally {
      setPreparing(false);
      setSigning(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
        <Minus size={16} className="mt-0.5 shrink-0 text-amber-400" />
        <div>
          <p className="font-semibold">Removing an intent is irreversible.</p>
          <p className="mt-1 text-xs text-amber-200/80">
            Open proposals against this slot become unexecutable. Indexes 0-2
            hold meta-intents and cannot be removed.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <LabelledField label="Intent index">
          <NumberInput value={index} onChange={setIndex} min={3} />
          <Hint>From the Intents list on the wallet page.</Hint>
        </LabelledField>
        <LabelledField label="Signature expiry (optional)">
          <input
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            placeholder="YYYY-MM-DD HH:MM:SS (UTC)"
            spellCheck={false}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-brand-white outline-none transition-colors focus:border-brand-green/50 focus:bg-white/10"
          />
          <Hint>Leave blank for the default 5-minute window.</Hint>
        </LabelledField>
      </div>

      <SignablePreview
        bodyText={preview?.bodyText ?? null}
        messageHex={preview?.hex ?? null}
        statusChip={
          preparing ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/70">
              <Loader2 size={10} className="animate-spin" /> computing
            </span>
          ) : !descriptor ? (
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/40">
              fill form
            </span>
          ) : null
        }
      />

      <button
        disabled={!valid || preparing || signing || !canSign}
        onClick={submit}
        className="group relative inline-flex items-center justify-center gap-2 rounded-2xl bg-rose-500/15 px-5 py-3.5 text-sm font-bold text-rose-300 ring-1 ring-rose-400/30 transition-all hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {preparing ? (
          <>
            <Loader2 size={16} className="animate-spin" /> Building message…
          </>
        ) : signing ? (
          <>
            <Loader2 size={16} className="animate-spin" /> Signing & relaying…
          </>
        ) : (
          <>
            <Trash2 size={16} />
            Sign & remove intent
            <ChevronRight size={16} className="transition-transform group-hover:translate-x-0.5" />
          </>
        )}
      </button>
      {!canSign && (
        <span className="text-xs text-text-muted">
          Connect a wallet that supports signMessage.
        </span>
      )}
    </div>
  );
}

// ── shared bits ──────────────────────────────────────────────────────

function LabelledField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
      {children}
    </span>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] leading-snug text-text-muted">{children}</span>;
}

function NumberInput({
  value,
  onChange,
  min,
}: {
  value: string;
  onChange: (v: string) => void;
  min?: number;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))}
      inputMode="numeric"
      placeholder={min !== undefined ? String(min) : "0"}
      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-brand-white outline-none transition-colors focus:border-brand-green/50 focus:bg-white/10"
    />
  );
}

function TemplateTile({
  template,
  selected,
  onSelect,
}: {
  template: TemplateCatalogEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  const { Icon } = template;
  return (
    <button
      onClick={onSelect}
      className={[
        "relative flex items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-all",
        selected
          ? "border-brand-green/60 bg-brand-green/10 shadow-glow"
          : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/5",
      ].join(" ")}
    >
      <div
        className={[
          "mt-0.5 rounded-lg p-1.5",
          chainToneClass(template.chainTone, selected),
        ].join(" ")}
      >
        <Icon size={14} />
      </div>
      <div className="flex flex-1 flex-col gap-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-brand-white">{template.label}</span>
          <span
            className={[
              "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              selected ? "bg-brand-green/20 text-brand-green" : "bg-white/5 text-white/60",
            ].join(" ")}
          >
            {template.chainLabel}
          </span>
        </div>
        <span className="text-[11px] leading-snug text-text-muted">{template.blurb}</span>
      </div>
    </button>
  );
}

function chainToneClass(tone: TemplateCatalogEntry["chainTone"], active: boolean): string {
  const base = active ? "text-black" : "text-white/80";
  const bg = {
    solana: active ? "bg-brand-green" : "bg-brand-green/20",
    spl: active ? "bg-brand-green" : "bg-brand-green/20",
    evm: active ? "bg-sky-400" : "bg-sky-400/20",
    btc: active ? "bg-amber-400" : "bg-amber-400/20",
    zec: active ? "bg-yellow-300" : "bg-yellow-300/20",
  }[tone];
  return `${bg} ${base}`;
}

function AddressChipInput({
  label,
  hint,
  values,
  onChange,
  placeholder,
  fallbackPreview,
}: {
  label: string;
  hint: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  fallbackPreview?: string;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const next = draft.trim();
    if (!next) return;
    if (values.includes(next)) {
      setDraft("");
      return;
    }
    onChange([...values, next]);
    setDraft("");
  };

  const remove = (addr: string) => onChange(values.filter((a) => a !== addr));

  return (
    <div className="flex flex-col gap-1.5">
      <SectionLabel>{label}</SectionLabel>
      <div className="flex min-h-[46px] flex-wrap items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-2 py-1.5">
        {values.length === 0 && (
          <span className="px-1.5 text-xs text-text-muted">
            {fallbackPreview ?? "defaults to connected wallet"}
          </span>
        )}
        {values.map((v) => (
          <motion.span
            key={v}
            layout
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="inline-flex items-center gap-1 rounded-full bg-brand-green/15 py-0.5 pl-2 pr-1 font-mono text-[11px] text-brand-green"
          >
            {shortAddr(v)}
            <button
              onClick={() => remove(v)}
              aria-label={`Remove ${v}`}
              className="rounded-full p-0.5 hover:bg-brand-green/25"
            >
              <X size={11} />
            </button>
          </motion.span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
            if (e.key === "Backspace" && !draft && values.length > 0) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={add}
          placeholder={placeholder}
          spellCheck={false}
          className="min-w-[120px] flex-1 bg-transparent px-1.5 py-1 text-xs text-brand-white outline-none placeholder:text-white/25"
        />
      </div>
      <Hint>{hint}</Hint>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────

function descriptorToPreview(d: DryRunDescriptor | null): { bodyText: string; hex: string } | null {
  if (!d) return null;
  try {
    const wrapped = fromHex(d.message_hex);
    const body = unwrapOffchain(wrapped);
    return {
      bodyText: new TextDecoder("utf-8", { fatal: false }).decode(body),
      hex: d.message_hex,
    };
  } catch {
    return { bodyText: "(unable to decode preview)", hex: d.message_hex };
  }
}

function shortAddr(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}

function explorerLink(
  res: Record<string, unknown>
): { label: string; href: string } | undefined {
  const txid = res.txid as string | undefined;
  if (!txid) return undefined;
  return {
    label: `tx ${txid.slice(0, 8)}…`,
    href: `https://explorer.solana.com/tx/${txid}?cluster=devnet`,
  };
}

function describeError(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { payload?: Record<string, unknown> };
  if (!e.payload) return undefined;
  try {
    return JSON.stringify(e.payload, null, 2);
  } catch {
    return undefined;
  }
}
