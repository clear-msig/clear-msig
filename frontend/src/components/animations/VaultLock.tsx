"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { LockOpen, Lock, ShieldCheck } from "lucide-react";
import { useRef } from "react";
import clsx from "clsx";

export function VaultLock() {
  const containerRef = useRef<HTMLDivElement>(null);
  
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start end", "center center"],
  });

  const light1 = useTransform(scrollYProgress, [0.2, 0.4], [0, 1]);
  const light2 = useTransform(scrollYProgress, [0.4, 0.6], [0, 1]);
  const light3 = useTransform(scrollYProgress, [0.6, 0.8], [0, 1]);
  
  const unlockThreshold = useTransform(scrollYProgress, [0.8, 0.9], [0, 1]);
  const rotateVault = useTransform(scrollYProgress, [0.8, 1], [0, 180]);
  
  return (
    <div ref={containerRef} className="relative flex flex-col items-center justify-center w-full max-w-3xl mx-auto py-32 overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
         <motion.div 
           style={{ scale: unlockThreshold, opacity: unlockThreshold }}
           className="w-[1000px] h-[2px] bg-gradient-to-r from-transparent via-brand-green to-transparent rotate-12 shadow-glow" 
         />
         <motion.div 
           style={{ scale: unlockThreshold, opacity: unlockThreshold }}
           className="absolute w-[1000px] h-[2px] bg-gradient-to-r from-transparent via-brand-green to-transparent -rotate-12 shadow-glow" 
         />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-12 bg-surface/50 backdrop-blur-xl border border-white/5 p-12 rounded-[3xl] shadow-2xl">
        <h3 className="text-2xl font-bold text-white mb-4">Multisig Consensus</h3>

        <div className="flex gap-6 mb-8">
          {[light1, light2, light3].map((lightOpacity, i) => (
             <div key={i} className="flex flex-col items-center gap-3">
               <div className="relative w-12 h-12 rounded-full bg-black/50 border border-white/10 flex items-center justify-center overflow-hidden">
                  <motion.div style={{ opacity: lightOpacity }} className="absolute inset-0 bg-brand-green shadow-glow opacity-0" />
                  <ShieldCheck size={20} className="relative z-10 text-white mix-blend-overlay" />
               </div>
               <span className="text-xs font-semibold text-text-muted">Signer {i+1}</span>
             </div>
          ))}
        </div>

        <motion.div 
           style={{ rotate: rotateVault }}
           className="relative w-32 h-32 rounded-full bg-gradient-to-b from-black to-surface border-4 border-white/10 flex items-center justify-center shadow-card-shadow"
        >
           <motion.div style={{ opacity: useTransform(unlockThreshold, [0, 0.5], [1, 0]) }} className="absolute">
              <Lock size={40} className="text-white/40" />
           </motion.div>
           <motion.div style={{ opacity: unlockThreshold, scale: unlockThreshold }} className="absolute">
              <LockOpen size={40} className="text-brand-green drop-shadow-[0_0_15px_rgba(20,241,149,0.8)]" />
           </motion.div>
        </motion.div>

        <motion.p style={{ opacity: unlockThreshold }} className="text-brand-green font-bold tracking-widest uppercase mt-4 text-sm">
           Payload Unlocked & Routed
        </motion.p>
      </div>
    </div>
  );
}
