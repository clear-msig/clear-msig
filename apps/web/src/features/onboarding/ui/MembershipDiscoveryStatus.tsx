"use client";

import { useState } from "react";

/** Stays mounted during retry so keyboard focus and the destination are kept. */
export function MembershipDiscoveryStatus({
  error,
  retrying,
  retry,
}: {
  error: boolean;
  retrying: boolean;
  retry: () => void;
}) {
  const [requested, setRequested] = useState(false);
  return (
    <div className="mt-3 w-full">
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="text-base leading-relaxed text-text-soft"
      >
        {retrying
          ? "Checking your shared wallets. This may take a few seconds on devnet."
          : error
            ? "You’re signed in, but we couldn’t load your wallets. Check your connection and try again. Your destination is saved."
            : "Opening your workspace."}
      </p>
      {(error || requested) && (
        <button
          type="button"
          aria-disabled={retrying}
          onClick={() => {
            if (retrying) return;
            setRequested(true);
            retry();
          }}
          className="neon-cta mt-6 inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-6 py-3 font-medium text-text-on-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent aria-disabled:cursor-wait aria-disabled:opacity-70"
        >
          {retrying ? "Checking wallets…" : "Retry loading wallets"}
        </button>
      )}
    </div>
  );
}
