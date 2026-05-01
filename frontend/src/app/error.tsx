"use client";

// Error boundary — Next App Router renders this for any unhandled
// runtime error inside the route tree. Retail-friendly fallback so an
// uncaught exception doesn't drop the user into a stack trace.
//
// `reset` is provided by Next; calling it re-mounts the route tree
// below the boundary, which usually fixes transient render errors
// (cache miss, hydration glitch, etc.).

import { useEffect } from "react";
import Link from "next/link";
import { ArrowRight, RefreshCcw, AlertCircle } from "lucide-react";
import { Button } from "@/components/retail/Button";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log so developers see the underlying cause in the console even
    // though the user only sees the friendly message.
    console.error("[error-boundary]", error);
  }, [error]);

  return (
    <main className="relative flex min-h-screen flex-col bg-canvas">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -left-32 -top-16 h-[55vh] w-[80vw] max-w-[640px] rounded-full bg-accent/[0.06] blur-3xl" />
      </div>

      <div className="relative z-10 flex flex-1 items-center justify-center px-gutter py-10">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-warning/10 text-warning">
            <AlertCircle className="h-7 w-7" strokeWidth={1.75} />
          </div>
          <h1 className="font-display text-display-sm leading-[1.05] text-text-strong text-balance">
            Something went wrong
          </h1>
          <p className="mt-3 text-base text-text-soft">
            Try again. This is usually a hiccup, not a real problem. If
            it keeps happening, let us know.
          </p>

          <div className="mt-8 flex flex-col gap-3">
            <Button size="lg" fullWidth onClick={reset}>
              <RefreshCcw className="h-4 w-4" aria-hidden="true" />
              Try again
            </Button>
            <Link href="/" className="block">
              <Button variant="ghost" size="md" fullWidth>
                Back to Clear
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Link>
          </div>

          {error.digest && (
            <p className="mt-6 font-mono text-[11px] text-text-soft/60">
              ref: {error.digest}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
