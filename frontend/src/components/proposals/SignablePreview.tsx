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
import { Copy, CheckCircle2, Terminal } from "lucide-react";

interface Props {
  bodyText: string | null;
  messageHex: string | null;
  /// Optional indicator rendered next to the "Signable preview" header .
  /// use for "rebuilding…" / error chips while the caller recomputes.
  statusChip?: React.ReactNode;
}

export function SignablePreview({ bodyText, messageHex, statusChip }: Props) {
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
