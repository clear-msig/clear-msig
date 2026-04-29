"use client";

// "What your Ledger will show" preview pane.
//
// Renders the exact UTF-8 body of the offchain-wrapped message the
// wallet is about to sign . side-by-side with the hex bytes. Clicking
// on either side can be copied for reference.
//
// The visual of this pane is the centerpiece of the clear-signing
// narrative: judges see the identical string their Ledger would
// display, in a terminal-style frame.

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Copy, CheckCircle2, Terminal, Network, Users, Sparkles } from "lucide-react";

export interface SigningContext {
  /// e.g. "treasury"
  wallet?: string;
  /// e.g. "Ethereum (EIP-1559)" — already humanised by the caller.
  chain?: string;
  /// e.g. "approve transfer", "propose add intent". Whatever verb best
  /// describes what the signer is acknowledging.
  action?: string;
  /// `{ current: 1, total: 3 }` — caller's choice whether to render a
  /// "your signature gets us to 1/3" cue.
  threshold?: { current: number; total: number };
}

interface Props {
  bodyText: string | null;
  messageHex: string | null;
  /// Optional indicator rendered next to the "Signable preview" header .
  /// use for "rebuilding…" / error chips while the caller recomputes.
  statusChip?: React.ReactNode;
  /// Surfaces the multisig + multi-chain + Ika context above the preview
  /// pane so the signer never has to hunt for what they're approving.
  context?: SigningContext;
}

export function SignablePreview({ bodyText, messageHex, statusChip, context }: Props) {
  const [copied, setCopied] = useState<"body" | "hex" | null>(null);

  const visibleBody = useMemo(
    () => (bodyText && bodyText.length > 0 ? bodyText : "."),
    [bodyText]
  );
  const visibleHex = useMemo(
    () => (messageHex && messageHex.length > 0 ? messageHex : "."),
    [messageHex]
  );

  const copy = async (which: "body" | "hex", text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 1200);
    } catch {
      /* noop */
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="relative overflow-hidden rounded-2xl border border-brand-green/20 bg-black/90 shadow-glow"
    >
      <div className="flex items-center justify-between gap-3 border-b border-white/5 bg-black/70 px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-green">
          <Terminal size={14} />
          <span>Signable preview</span>
        </div>
        <div className="flex items-center gap-2">
          {statusChip}
          <span className="hidden text-[10px] font-medium uppercase tracking-wide text-white/40 sm:inline">
            What your Ledger will display
          </span>
        </div>
      </div>

      {context && hasAnyContext(context) && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-white/5 bg-black/60 px-4 py-2">
          {context.action && (
            <ContextChip
              icon={<Sparkles size={10} />}
              label="Action"
              value={context.action}
              tone="green"
            />
          )}
          {context.wallet && (
            <ContextChip
              icon={<Users size={10} />}
              label="Wallet"
              value={context.wallet}
            />
          )}
          {context.chain && (
            <ContextChip
              icon={<Network size={10} />}
              label="Chain"
              value={context.chain}
            />
          )}
          {context.threshold && (
            <ContextChip
              icon={<Users size={10} />}
              label="Threshold"
              value={`${context.threshold.current}/${context.threshold.total}`}
            />
          )}
          <span className="ml-auto text-[10px] uppercase tracking-wider text-white/30">
            Ika dWallet · 2PC-MPC
          </span>
        </div>
      )}

      <div className="grid gap-0 lg:grid-cols-2">
        <Pane
          title="Human-readable"
          body={visibleBody}
          monospace
          onCopy={() => copy("body", visibleBody)}
          copied={copied === "body"}
        />
        <div className="border-t border-white/5 lg:border-l lg:border-t-0">
          <Pane
            title="Signed bytes (hex)"
            body={visibleHex}
            monospace
            onCopy={() => copy("hex", visibleHex)}
            copied={copied === "hex"}
            dimmed
          />
        </div>
      </div>
    </motion.div>
  );
}

function hasAnyContext(c: SigningContext): boolean {
  return Boolean(c.action || c.wallet || c.chain || c.threshold);
}

function ContextChip({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "green";
}) {
  const toneClass =
    tone === "green"
      ? "border-brand-green/30 bg-brand-green/10 text-brand-green"
      : "border-white/10 bg-white/5 text-white/80";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${toneClass}`}
    >
      {icon}
      <span className="text-white/40">{label}</span>
      <span className="font-mono">{value}</span>
    </span>
  );
}

function Pane({
  title,
  body,
  monospace,
  onCopy,
  copied,
  dimmed,
}: {
  title: string;
  body: string;
  monospace?: boolean;
  onCopy: () => void;
  copied: boolean;
  dimmed?: boolean;
}) {
  return (
    <div className="relative flex min-h-[120px] flex-col px-4 py-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wide text-white/40">
          {title}
        </span>
        <button
          onClick={onCopy}
          aria-label="Copy to clipboard"
          className="relative rounded-full p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
        >
          <AnimatePresence mode="wait" initial={false}>
            {copied ? (
              <motion.span
                key="ok"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.15 }}
              >
                <CheckCircle2 size={14} className="text-brand-green" />
              </motion.span>
            ) : (
              <motion.span
                key="copy"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <Copy size={14} />
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
      <pre
        className={[
          "whitespace-pre-wrap break-all text-[12px] leading-relaxed",
          monospace ? "font-mono" : "",
          dimmed ? "text-white/50" : "text-white/90",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {body}
      </pre>
    </div>
  );
}
