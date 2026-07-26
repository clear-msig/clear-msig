"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { FadeInFn } from "./types";
import { ClearCMark } from "@/components/landing/ClearCMark";

export function Footer({ fadeIn }: { fadeIn: FadeInFn }) {
  return (
    <footer className="relative left-1/2 right-1/2 z-10 -ml-[50vw] -mr-[50vw] w-screen overflow-hidden bg-black pb-10 pt-20 sm:pt-32">
      <div className="relative mx-auto w-full max-w-[1600px] px-5 sm:px-10">
        {/* CTA stack */}
        <div className="relative mx-auto max-w-3xl text-center">
          <motion.div {...fadeIn(0)} className="flex items-center justify-center gap-2">
            <span className="font-mono-tech text-[10px] uppercase tracking-[0.32em] text-white/60">
              Ready when you are
            </span>
          </motion.div>

          <motion.h2
            {...fadeIn(0.06)}
            className="landing-section-heading mt-5 text-[clamp(2rem,6vw,5rem)] font-light leading-[0.95] tracking-[-0.04em] text-white sm:mt-6"
          >
            Open your <span className="italic-skew">control</span>
            <br />
            wallet.
          </motion.h2>

          <motion.div {...fadeIn(0.14)} className="mt-8 flex justify-center sm:mt-10">
            <Link
              href="/choose"
              className="neon-cta inline-flex items-center gap-3 rounded-full px-7 py-4 text-[14px] font-bold tracking-tight sm:px-9 sm:py-5 sm:text-[15px]"
            >
              Get started
              <ArrowRight className="h-5 w-5" strokeWidth={2.5} aria-hidden="true" />
            </Link>
          </motion.div>
        </div>

        {/* 3-col bottom */}
        <div className="relative mt-24 grid grid-cols-1 gap-8 border-t border-white/10 pt-8 sm:mt-40 sm:gap-10 sm:pt-10 md:grid-cols-3">
          <div>
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg">
                <ClearCMark size={28} variant="on-dark" />
              </span>
              <span className="font-mono-tech text-[10px] uppercase tracking-[0.28em] text-white/60">
                clearsig
              </span>
            </div>
            <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-white/50">
              Early preview. Test network only - please don&apos;t use real money yet.
            </p>
          </div>

          <div className="flex flex-wrap gap-x-8 gap-y-2 md:justify-center">
            {[
              { href: "/privacy", label: "Privacy" },
              { href: "/security", label: "Security" },
              { href: "/choose", label: "Choose product" },
            ].map((l) => (
              <Link
                key={l.label}
                href={l.href}
                className="font-mono-tech text-[11px] uppercase tracking-[0.2em] text-white/60 transition-colors duration-200 hover:text-[#ccff00]"
              >
                {l.label}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-4 md:justify-end">
            <Link
              href="https://x.com/Clearsig_XYZ"
              target="_blank"
              rel="noreferrer"
              aria-label="Clearsig on X"
              title="@Clearsig_XYZ"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-white/60 transition-colors duration-200 hover:border-[#ccff00] hover:text-[#ccff00]"
            >
              <XGlyph />
            </Link>
            <a
              href="mailto:info@clearsig.xyz"
              aria-label="Email Clearsig"
              title="info@clearsig.xyz"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-white/60 transition-colors duration-200 hover:border-[#ccff00] hover:text-[#ccff00]"
            >
              <MailGlyph />
            </a>
            <Link
              href="https://github.com/clear-msig/clear-msig"
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-white/60 transition-colors duration-200 hover:border-[#ccff00] hover:text-[#ccff00]"
            >
              <GitHubGlyph />
            </Link>
            <span className="font-mono-tech text-[10px] uppercase tracking-[0.24em] text-white/40">
              © 2026 clearsig
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}

function GitHubGlyph() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z" />
    </svg>
  );
}

function XGlyph() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function MailGlyph() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}
