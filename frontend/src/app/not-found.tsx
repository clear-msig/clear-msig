// Custom not-found page — Next App Router renders this for any route
// that doesn't match. Retail-styled fallback so users hitting a stale
// share link or a typo see something on-brand instead of the framework
// default.

import Link from "next/link";
import { ArrowRight, Compass } from "lucide-react";
import { Button } from "@/components/retail/Button";

export default function NotFound() {
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
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Compass className="h-7 w-7" strokeWidth={1.75} />
          </div>
          <h1 className="font-display text-display-sm leading-[1.05] text-text-strong text-balance">
            We couldn&rsquo;t find that page
          </h1>
          <p className="mt-3 text-base text-text-soft">
            The link may be old, mistyped, or the page has moved.
            Let&rsquo;s get you back to somewhere that exists.
          </p>
          <Link href="/" className="mt-8 inline-block">
            <Button size="lg">
              Back to Clear
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
