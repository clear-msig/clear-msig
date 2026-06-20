"use client";

// QuickSendInput - type a sentence, the form fills in.
//
// Sits above the canonical step-by-step form on /send. The user
// types something like "send sarah 5 sol for groceries" and we
// post-and-prefill: recipient, amount, note all populate. They
// review the form, edit if anything's off, then sign as normal.
//
// Why no "AI" framing in copy: retail users associate "AI" with
// chatbots, not form-fill. We say "Just say it" so the input reads
// as a shortcut, not a co-pilot. Same trick Linear uses for their
// command bar - power feature, plain copy.
//
// Privacy: only the typed text + the user's contact NAMES leave the
// browser (no addresses). The server route at /api/nl/parse is the
// single egress point; if `NEXT_PUBLIC_NL_ENABLED=false` (or the
// route is unconfigured), nothing renders.

import { useState } from "react";
import { X } from "lucide-react";
import { BrandLoader } from "@/components/retail/BrandLoader";

// Universal AI sparkle - two four-pointed stars, the smaller one
// offset. The de facto "this is AI" glyph used by Apple Intelligence,
// Google Gemini, and the Anthropic Claude marks. Inline so we don't
// pull a one-off icon dep, and so we can tune the secondary star's
// opacity to match the surrounding tone.
function AiSparkle({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M11 2.5c.55 4.4 1.55 5.4 5.95 5.95-4.4.55-5.4 1.55-5.95 5.95-.55-4.4-1.55-5.4-5.95-5.95 4.4-.55 5.4-1.55 5.95-5.95Z" />
      <path
        d="M18 13c.3 2.4.8 2.9 3.2 3.2-2.4.3-2.9.8-3.2 3.2-.3-2.4-.8-2.9-3.2-3.2 2.4-.3 2.9-.8 3.2-3.2Z"
        opacity="0.7"
      />
    </svg>
  );
}

interface QuickSendParse {
  recipientText?: string;
  amountSol?: number;
  note?: string;
  confidence: "high" | "low";
  ambiguity?: string;
}

interface QuickSendInputProps {
  /// Names from the user's contacts list - passed to the server so
  /// "send sarah" resolves against actual contacts rather than the
  /// model guessing.
  contactNames: string[];
  /// Called once the parser returns a usable result. Caller decides
  /// which fields to write into the form (we don't pre-write empty
  /// strings, only present fields).
  onParsed: (result: QuickSendParse) => void;
}

export function QuickSendInput({ contactNames, onParsed }: QuickSendInputProps) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setHint(null);
    try {
      const res = await fetch("/api/nl/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: trimmed, contactNames }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : `Parser returned ${res.status}`,
        );
      }
      const result = (await res.json()) as QuickSendParse;
      onParsed(result);
      // Stash an ambiguity hint inline so the user knows to verify
      // before signing - the form is filled but flagged.
      setHint(
        result.confidence === "low" && result.ambiguity
          ? result.ambiguity
          : null,
      );
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't parse that.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-card border border-accent/30 bg-accent/[0.04] p-2.5 shadow-card-rest sm:p-3">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent sm:h-7 sm:w-7"
        >
          <AiSparkle className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </span>
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !loading) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="Just say it. “send Sarah 5 sol for rent”"
          maxLength={280}
          spellCheck={false}
          autoComplete="off"
          disabled={loading}
          className={
            "flex-1 bg-transparent py-1 text-sm text-text-strong outline-none placeholder:text-text-soft/70 " +
            "disabled:cursor-not-allowed disabled:opacity-50"
          }
        />
        {text && !loading && (
          <button
            type="button"
            onClick={() => setText("")}
            aria-label="Clear"
            className="rounded-soft p-1 text-text-soft hover:bg-canvas hover:text-text-strong"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading || !text.trim()}
          className={
            // min-h-tap (44px) so the Fill-in button hits Apple HIG
            // tap-target minimum on mobile. Was py-1.5 (24px) which
            // the parity audit flagged as too small to land reliably
            // with a thumb. Visual size barely changes - the label
            // already wants vertical breathing room.
            "inline-flex min-h-tap items-center justify-center rounded-soft bg-accent px-3 py-2 text-xs font-medium text-text-on-accent shadow-accent-rest sm:px-4 " +
            "transition-[background-color,transform] duration-base ease-out-soft " +
            "hover:bg-accent-hover active:scale-[0.98] " +
            "disabled:cursor-not-allowed disabled:opacity-50"
          }
        >
          {loading ? (
            <BrandLoader variant="dot" tone="on-accent" size={4} />
          ) : (
            "Fill in"
          )}
        </button>
      </div>
      {hint && (
        <p className="mt-2 pl-6 text-[11px] text-text-soft">
          ⚠️ {hint}. Double-check the form before signing.
        </p>
      )}
      {error && (
        <p className="mt-2 pl-6 text-[11px] text-warning">{error}</p>
      )}
    </div>
  );
}
