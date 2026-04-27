"use client";

import { useState } from "react";
import Image from "next/image";
import { motion, useScroll, useMotionValueEvent } from "framer-motion";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { LogOut } from "lucide-react";
import clsx from "clsx";

export function HeaderBar() {
  const { connected, disconnect } = useWallet();
  const { scrollY } = useScroll();
  const [isScrolled, setIsScrolled] = useState(false);

  useMotionValueEvent(scrollY, "change", (latest) => {
    setIsScrolled(latest > 20);
  });

  return (
    <motion.header
      initial={{ opacity: 0, y: -40, x: "-50%" }}
      animate={{ opacity: 1, y: 0, x: "-50%" }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className={clsx(
        "fixed top-4 left-1/2 z-[100] flex flex-col sm:flex-row sm:items-center sm:justify-between shadow-2xl transition-all duration-500 overflow-hidden",
        isScrolled 
          ? "w-[calc(100%-2rem)] sm:w-auto max-w-fit rounded-full bg-black/70 backdrop-blur-xl px-4 py-2 sm:px-6 sm:py-3 border border-white/10" 
          : "w-[calc(100%-2rem)] max-w-7xl rounded-[2.5rem] bg-black px-6 py-5 border-transparent"
      )}
    >
      <div className={clsx(
        "absolute top-[-50%] left-[-5%] w-[40%] h-[200%] bg-brand-green/10 blur-[60px] pointer-events-none transition-opacity",
        isScrolled ? "opacity-0" : "opacity-100"
      )} />
      
      <div className={clsx(
        "relative flex items-center justify-between z-10 transition-all",
        isScrolled ? "w-full sm:w-auto gap-8" : "w-full gap-4"
      )}>
        <div className="flex items-center gap-3">
          <motion.div 
             whileHover={{ rotate: 360 }}
             transition={{ duration: 0.8, ease: "easeInOut" }}
             className={clsx(
               "flex shrink-0 items-center justify-center bg-brand-green p-[2px] shadow-glow transition-all",
               isScrolled ? "h-10 w-10 rounded-full" : "h-12 w-12 rounded-[1rem]"
             )}
          >
             <div className={clsx("flex h-full w-full items-center justify-center bg-black", isScrolled ? "rounded-full" : "rounded-[0.9rem]")}>
                <Image src="/assets/solana.png" alt="Solana" width={isScrolled ? 20 : 24} height={isScrolled ? 20 : 24} className="rounded-full" />
             </div>
          </motion.div>
          
          <div className={clsx("flex flex-col transition-all hidden sm:flex")}>
            <p className={clsx("font-bold tracking-tight text-white", isScrolled ? "text-base" : "text-xl")}>Clear-MSIG</p>
            {!isScrolled && <p className="text-sm font-medium text-white/50 sm:whitespace-nowrap">Cross-chain dWallet Orchestration</p>}
          </div>
        </div>
        
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <WalletMultiButton className={clsx(
            "!bg-brand-green !font-bold !text-black shadow-glow transition-all hover:!bg-white hover:!text-black hover:shadow-glow-hover whitespace-nowrap",
            isScrolled ? "!rounded-full !px-5 !py-[6px] !text-xs !h-auto" : "!rounded-2xl !px-6 !py-2 !text-sm"
          )} />
          
          {connected && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={disconnect}
              className={clsx(
                "flex items-center justify-center shrink-0 border border-red-500/20 bg-red-500/10 text-red-500 shadow-lg transition-colors hover:bg-red-500/20",
                isScrolled ? "h-[32px] w-[32px] rounded-full" : "h-[42px] w-[42px] rounded-2xl"
              )}
              title="Log out"
            >
              <LogOut size={isScrolled ? 16 : 18} />
            </motion.button>
          )}
        </div>
      </div>
    </motion.header>
  );
}
