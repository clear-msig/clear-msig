"use client";

// Closing CTA. Twin vault doors slide together as the user scrolls,
// revealing a "Connect wallet" orb at the seam. Preserved from the
// original landing page; decoupled from the hero so it composes into
// the new narrative flow.

import Image from "next/image";
import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { ShieldCheck, LockOpen } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

export function VaultConnectSection() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 90%", "center center"],
  });
  const leftDoorX = useTransform(scrollYProgress, [0, 1], ["20%", "0%"]);
  const rightDoorX = useTransform(scrollYProgress, [0, 1], ["-20%", "0%"]);
  const scaleLine = useTransform(scrollYProgress, [0.4, 0.8], [0, 1]);
  const scaleOrb = useTransform(scrollYProgress, [0.5, 1], [0.8, 1]);
  const opacityOrb = useTransform(scrollYProgress, [0.5, 1], [0, 1]);

  return (
    <section
      ref={ref}
      id="connect"
      className="relative flex w-full flex-col items-center justify-center py-16 sm:py-24"
    >
      <div className="mx-auto mb-12 max-w-3xl px-4 text-center sm:mb-16">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-black/5 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-black/70">
          Ready?
        </span>
        <h2 className="mt-4 font-display text-3xl font-bold leading-tight tracking-tight text-black text-balance sm:text-4xl lg:text-5xl">
          Your signature unlocks any chain.
        </h2>
        <p className="mt-3 text-sm text-black/60 sm:text-base">
          Connect a Solana wallet to open the dashboard. Devnet keys only,
          this is the pre-alpha.
        </p>
      </div>

      <div className="relative z-10 flex w-full max-w-6xl flex-col items-center justify-center gap-0 px-4 sm:px-10 lg:flex-row lg:justify-between">
        {/* Left door */}
        <motion.div
          style={{ x: leftDoorX }}
          className="relative z-20 flex w-full max-w-[320px] flex-col justify-center rounded-3xl border border-white/10 bg-black p-6 shadow-card-dark sm:h-[360px] sm:p-8 lg:max-w-[280px] lg:rounded-l-[3rem] lg:rounded-r-none"
        >
          <div className="absolute inset-x-0 bottom-0 h-1.5 bg-brand-green shadow-glow lg:inset-y-0 lg:left-auto lg:right-0 lg:h-auto lg:w-1.5" />
          <ShieldCheck
            className="mb-6 h-8 w-8 text-brand-green opacity-80 sm:h-10 sm:w-10"
            aria-hidden="true"
          />
          <h3 className="mb-1 font-display text-xl font-bold text-white sm:text-2xl">
            Multisig
            <br />
            consensus
          </h3>
          <p className="mb-6 text-xs font-medium text-white/50 sm:text-sm">
            3 / 4 signers approved
          </p>
          <div className="space-y-2 sm:space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-2 sm:gap-3">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-green shadow-glow sm:h-2 sm:w-2"
                />
                <span className="font-mono text-[10px] text-brand-green sm:text-xs">
                  Signer 0x{i}A… confirmed
                </span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Mobile merge line top */}
        <motion.div
          style={{ scaleY: scaleLine, transformOrigin: "top" }}
          className="relative my-0 h-12 w-[2px] bg-brand-green shadow-glow lg:hidden"
        />

        {/* Desktop beam left */}
        <div className="relative z-10 mx-4 hidden h-16 flex-1 items-center justify-end lg:flex">
          <motion.div
            style={{ scaleX: scaleLine }}
            className="absolute right-0 h-[2px] w-full origin-right bg-brand-green shadow-glow"
          />
        </div>

        {/* Connect orb */}
        <motion.div
          style={{ opacity: opacityOrb, scale: scaleOrb }}
          className="relative z-30 w-full shrink-0 sm:w-auto"
        >
          <ConnectWalletOrb />
        </motion.div>

        {/* Mobile merge line bottom */}
        <motion.div
          style={{ scaleY: scaleLine, transformOrigin: "top" }}
          className="relative my-0 h-12 w-[2px] bg-brand-green shadow-glow lg:hidden"
        />

        {/* Desktop beam right */}
        <div className="relative z-10 mx-4 hidden h-16 flex-1 items-center justify-start lg:flex">
          <motion.div
            style={{ scaleX: scaleLine }}
            className="absolute left-0 h-[2px] w-full origin-left bg-brand-green shadow-glow"
          />
        </div>

        {/* Right door */}
        <motion.div
          style={{ x: rightDoorX }}
          className="relative z-20 flex w-full max-w-[320px] flex-col items-start justify-center rounded-3xl border border-white/10 bg-black p-6 shadow-card-dark sm:h-[360px] sm:p-8 lg:max-w-[280px] lg:items-end lg:rounded-l-none lg:rounded-r-[3rem]"
        >
          <div className="absolute inset-x-0 top-0 h-1.5 bg-brand-green shadow-glow lg:inset-y-0 lg:left-0 lg:right-auto lg:h-auto lg:w-1.5" />
          <LockOpen
            className="mb-6 h-8 w-8 text-brand-green opacity-80 sm:h-10 sm:w-10"
            aria-hidden="true"
          />
          <h3 className="mb-1 font-display text-xl font-bold text-white sm:text-2xl lg:text-right">
            Payload
            <br />
            unlocked
          </h3>
          <p className="mb-6 text-xs font-medium text-white/50 sm:text-sm lg:text-right">
            Awaiting execution
          </p>
          <div className="flex w-full flex-col gap-2 sm:gap-3 lg:items-end">
            <DestRow chain="ETH" src="/assets/ethereum.png" />
            <DestRow chain="BTC" src="/assets/bitcoin.png" />
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function DestRow({ chain, src }: { chain: string; src: string }) {
  return (
    <div className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 lg:justify-end">
      <span className="font-mono text-[10px] text-white/60 sm:text-xs">
        Dest: {chain}
      </span>
      <Image src={src} alt={chain} width={22} height={22} className="drop-shadow-md" />
    </div>
  );
}

function ConnectWalletOrb() {
  const wallet = useWallet();
  const { setVisible } = useWalletModal();

  return (
    <div className="relative mx-auto flex w-full max-w-sm flex-col items-center gap-4 rounded-[2rem] border border-black/10 bg-white/70 px-6 py-8 text-center shadow-card-shadow backdrop-blur-sm sm:max-w-md sm:gap-5 sm:px-10 sm:py-10">
      <span
        aria-hidden="true"
        className="absolute inset-1/2 h-[220px] w-[220px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-brand-green/40 [animation:spin_14s_linear_infinite] sm:h-[260px] sm:w-[260px]"
      />
      <span
        aria-hidden="true"
        className="absolute inset-1/2 h-[280px] w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-brand-green/30 [animation:spin_20s_linear_infinite_reverse] sm:h-[320px] sm:w-[320px]"
      />
      <div className="relative z-10 flex h-16 w-16 items-center justify-center rounded-full border-2 border-brand-green/60 bg-black text-brand-green shadow-glow sm:h-20 sm:w-20">
        <ShieldCheck size={30} />
      </div>
      <div className="relative z-10 space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-black/50 sm:text-xs">
          Final step
        </p>
        <h3 className="font-display text-2xl font-extrabold text-black sm:text-3xl">
          Connect wallet
        </h3>
        <p className="px-2 text-xs font-medium text-black/60 sm:text-sm">
          Open the dashboard and bring your team's multisig to life.
        </p>
      </div>
      <motion.button
        type="button"
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.96 }}
        onClick={() => setVisible(true)}
        className="relative z-10 mt-2 rounded-2xl border border-brand-green/20 bg-black px-7 py-3 text-xs font-bold uppercase tracking-wider text-brand-green shadow-card-shadow transition-colors hover:bg-brand-green hover:text-black sm:px-8 sm:text-sm"
      >
        {wallet.connected ? "Wallet connected" : "Connect wallet"}
      </motion.button>
      {wallet.connected && (
        <p className="relative z-10 text-xs font-semibold text-black/50">
          Connected: {wallet.publicKey?.toBase58().slice(0, 4)}…
          {wallet.publicKey?.toBase58().slice(-4)}
        </p>
      )}
    </div>
  );
}
