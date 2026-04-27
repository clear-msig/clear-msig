"use client";

import { motion, useScroll, useTransform, useSpring } from "framer-motion";
import { useRef, useState, useEffect } from "react";
import { Copy, CheckCircle2 } from "lucide-react";
import clsx from "clsx";

export function MagnifyingGlass() {
  const containerRef = useRef<HTMLDivElement>(null);
  
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start end", "end start"],
  });

  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001
  });

  // Moves the magnifying glass across the raw hex data
  const lensX = useTransform(smoothProgress, [0.2, 0.8], ["-40%", "40%"]);
  // Fades in the real data as the lens sweeps
  const revealOpacity = useTransform(smoothProgress, [0.4, 0.6], [0, 1]);

  return (
    <div ref={containerRef} className="relative flex flex-col items-center justify-center w-full max-w-4xl mx-auto py-32 overflow-hidden">
      
      <h3 className="text-2xl font-bold text-white mb-12 relative z-20">Clear Intent Resolution</h3>

      <div className="relative w-full h-[300px] bg-surface border border-white/5 rounded-[xl] overflow-hidden flex items-center justify-center select-none">
        
        {/* Background Raw Hex Data - Blurred & Dimmed */}
        <div className="absolute inset-0 p-8 flex flex-wrap gap-2 text-text-muted/30 font-mono text-sm blur-[2px]">
          {Array.from({ length: 200 }).map((_, i) => (
            <span key={i}>
              {Math.random().toString(16).substr(2, 4).toUpperCase()}
            </span>
          ))}
        </div>

        {/* The Decoded clear intention UI - Hidden until revealed */}
        <motion.div 
           style={{ opacity: revealOpacity }}
           className="absolute inset-0 flex items-center justify-center z-10 bg-surface/80 backdrop-blur-md"
        >
          <div className="flex gap-4 items-center bg-black/60 p-6 rounded-2xl border border-brand-green/30 shadow-[0_0_30px_rgba(20,241,149,0.1)]">
             <div className="flex flex-col gap-1">
               <span className="text-xs text-text-muted">Action</span>
               <span className="text-white font-medium">Transfer USDC</span>
             </div>
             <div className="w-px h-10 bg-white/10" />
             <div className="flex flex-col gap-1">
               <span className="text-xs text-text-muted">Amount</span>
               <span className="text-brand-green font-bold text-lg">5,000.00</span>
             </div>
             <div className="w-px h-10 bg-white/10" />
             <div className="flex flex-col gap-1">
               <span className="text-xs text-text-muted">Destination</span>
               <span className="text-white font-mono text-sm">0x71C...9A23</span>
             </div>
          </div>
        </motion.div>

        {/* The Magnifying Glass Lens effect floating over everything */}
        <motion.div 
           style={{ x: lensX }}
           className="absolute w-[300px] h-[300px] rounded-full border border-white/10 shadow-[inset_0_0_50px_rgba(255,255,255,0.05)] backdrop-blur-sm z-20 flex items-center justify-center pointer-events-none"
        >
          {/* Inner ring for realism */}
          <div className="w-[280px] h-[280px] rounded-full border border-white/5 bg-gradient-to-tr from-white/5 to-transparent" />
        </motion.div>

      </div>
    </div>
  );
}
