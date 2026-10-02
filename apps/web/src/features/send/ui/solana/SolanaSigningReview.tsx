"use client";

import { useEffect, useRef } from "react";
import type { SigningReview } from "@/features/send/domain/signingReview";

export function SolanaSigningReview({ review, onConfirm, onCancel }: {
  review: SigningReview;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return (
    <section aria-labelledby="sol-signing-review" className="flex min-w-0 flex-col gap-4 rounded-card border border-border-soft bg-surface-raised p-5">
      <h2 ref={heading} tabIndex={-1} id="sol-signing-review" className="font-display text-xl font-semibold">Review before signing</h2>
      <p className="text-sm text-text-soft">Requested: {review.amount} SOL to <span className="break-all font-mono text-text-strong">{review.destination}</span>.</p>
      <p className="text-sm text-text-soft">Below is the exact prepared message for the next wallet prompt. Review the action, destination, rules and approval scope. No signature has been requested yet.</p>
      <pre aria-label="Exact prepared signing message" className="whitespace-pre-wrap break-words rounded-soft border border-border-soft bg-canvas p-4 font-mono text-xs leading-relaxed text-text-strong [overflow-wrap:anywhere]">{review.document}</pre>
      <p className="text-sm text-text-soft">The server prepares this document; the app checks its descriptor binding. This display is not independent verification. Cancel if you cannot verify the requested action.</p>
      <p className="text-sm text-text-soft">This signing step may also count as your approval. This flow can request execution once approvals, timelock and on-chain checks allow it.</p>
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <button type="button" onClick={onConfirm} className="min-h-11 rounded-full bg-accent px-5 py-3 font-semibold text-text-on-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">Continue to wallet</button>
        <button type="button" onClick={onCancel} className="min-h-11 rounded-full border border-border-soft px-5 py-3 text-text-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">Cancel review</button>
      </div>
    </section>
  );
}
