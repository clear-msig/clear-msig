"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/retail/Button";
import clsx from "clsx";

export default function VaultPage() {
  const router = useRouter();
  const reduce = useReducedMotion();

  const fadeIn = (delay = 0) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 20 },
          animate: { opacity: 1, y: 0 },
          transition: {
            duration: 0.6,
            delay,
            ease: [0.22, 1, 0.36, 1],
          },
        };

  const handleVisitIka = () => {
    // Open solana.ikavery.com in a new tab
    window.open("https://solana.ikavery.com", "_blank", "noopener");
  };

  return (
    <motion.div
      {...fadeIn(0)}
      className="mx-auto flex h-[calc(100vh-4rem)] w-full max-w-[28rem] flex-col items-center gap-8"
    >
      {/* Header */}
      <div className="flex flex-col items-center text-center space-y-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-text-soft">
          Powered by Ika
        </p>
        <h1 className="font-display text-display-sm leading-[1.05] tracking-[-0.02em] text-text-strong text-balance">
          Your key, under quorum
        </h1>
        <p className="mx-auto max-w-md text-[15px] leading-relaxed text-text-soft">
          Import your private key into an Ika dWallet and recover it with just three taps
          from your trusted devices.
        </p>
      </div>

      {/* Three-step flow */}
      <div className="flex w-full flex-col gap-6">
        {/* Step 1: Build a vault */}
        <motion.div
          key="step-1"
          {...fadeIn(0.1)}
          className="flex flex-col gap-3"
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-soft">
            // 01
          </p>
          <div className="flex items-start gap-4">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/[0.08] text-accent ring-1 ring-accent/20"
            >
              <VaultIcon className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col leading-tight">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-soft">
                Build a vault
              </p>
              <p className="mt-1 font-display text-lg font-semibold tracking-[-0.015em] text-text-strong">
                Create your Ika dWallet
              </p>
              <p className="mt-2 max-w-md text-[13.5px] leading-relaxed text-text-soft">
                Generate a threshold-signed wallet that lives on Solana devnet.
              </p>
            </div>
          </div>
        </motion.div>

        {/* Step 2: Add devices */}
        <motion.div
          key="step-2"
          {...fadeIn(0.2)}
          className="flex flex-col gap-3"
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-soft">
            // 02
          </p>
          <div className="flex items-start gap-4">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/[0.08] text-accent ring-1 ring-accent/20"
            >
              <DeviceIcon className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col leading-tight">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-soft">
                Add devices
              </p>
              <p className="mt-1 font-display text-lg font-semibold tracking-[-0.015em] text-text-strong">
                Register your trusted devices
              </p>
              <p className="mt-2 max-w-md text-[13.5px] leading-relaxed text-text-soft">
                Enroll iPhone, MacBook, YubiKey, or any WebAuthn authenticator.
              </p>
            </div>
          </div>
        </motion.div>

        {/* Step 3: Import key */}
        <motion.div
          key="step-3"
          {...fadeIn(0.3)}
          className="flex flex-col gap-3"
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-soft">
            // 03
          </p>
          <div className="flex items-start gap-4">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/[0.08] text-accent ring-1 ring-accent/20"
            >
              <KeyIcon className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col leading-tight">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-soft">
                Import key
              </p>
              <p className="mt-1 font-display text-lg font-semibold tracking-[-0.015em] text-text-strong">
                Seal your private key in MPC
              </p>
              <p className="mt-2 max-w-md text-[13.5px] leading-relaxed text-text-soft">
                Your key is now protected by quorum — recover with any t-of-N device approvals.
              </p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* CTA */}
      <motion.div
        key="cta"
        {...fadeIn(0.4)}
        className="flex w-full items-center justify-center"
      >
        <Button
          size="lg"
          fullWidth
          onClick={handleVisitIka}
          className="neon-cta"
        >
          Visit solana.ikavery.com
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </Button>
      </motion.div>

      {/* Footer note */}
      <motion.div
        key="footer"
        {...fadeIn(0.5)}
        className="text-[11px] uppercase tracking-[0.24em] text-text-soft/60"
      >
        Pre-alpha • Not for production use • <a href="https://ika.xyz" className="text-accent hover:underline">ika.xyz</a>
      </motion.div>
    </motion.div>
  );
}

// Icons
function VaultIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 2L2 7L12 12L22 7L12 2ZM2 17L12 22L22 17L12 12L2 17Z"
        fill="currentColor"
      />
    </svg>
  );
}

function DeviceIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M4 4H20V20H4V4ZM6 8H18V18H6V8Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 4L15 7H9L12 4ZM12 4L12 20M9 11L12 8L15 11"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}