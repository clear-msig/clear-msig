"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ClearCMark } from "./ClearCMark";

/** Quiet shared backdrop for product/onboarding pages. */
export function LandingAtmospherics() {
  return (
    <div
      aria-hidden="true"
      className="brand-watermark pointer-events-none absolute inset-0"
    />
  );
}

interface LandingNavProps {
  cta?: { href: string; label: string } | null;
  status?: string;
}

export function LandingNav({
  cta = { href: "/choose", label: "Get started" },
  status,
}: LandingNavProps = {}) {
  return (
    <>
      <header className="brand-navigation fixed inset-x-0 top-0 z-40 bg-canvas">
        <nav
          aria-label="Main navigation"
          className="mx-auto flex h-16 max-w-[1920px] items-center justify-between gap-5 px-5 sm:px-7"
        >
          <Link
            href="/"
            aria-label="ClearSig home"
            className="inline-flex min-h-tap items-center gap-3"
          >
            <ClearCMark size={30} variant="on-dark" alt="" />
            <span className="text-base font-semibold tracking-tight text-text-strong">
              ClearSig
            </span>
          </Link>
          <div className="flex items-center gap-7">
            {!status && (
              <div className="hidden items-center gap-7 md:flex">
                <Link
                  href="/#how-it-works"
                  className="inline-flex min-h-tap items-center text-sm text-text-soft hover:text-text-strong"
                >
                  How it works
                </Link>
                <Link
                  href="/#products"
                  className="inline-flex min-h-tap items-center text-sm text-text-soft hover:text-text-strong"
                >
                  Products
                </Link>
              </div>
            )}
            {status && <span className="text-xs text-text-soft">{status}</span>}
            {cta && (
              <Link
                href={cta.href}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border-strong bg-surface-raised px-4 text-sm font-medium text-text-strong transition-colors hover:border-accent/50 hover:bg-glass-soft sm:px-5"
              >
                {cta.label}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            )}
          </div>
        </nav>
      </header>
      <div aria-hidden="true" className="h-16" />
    </>
  );
}
