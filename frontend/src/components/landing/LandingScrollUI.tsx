"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronUp } from "lucide-react";

export function LandingScrollProgress() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const scrollHeight =
        document.documentElement.scrollHeight - window.innerHeight;
      const pct = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
      setProgress(Math.min(100, Math.max(0, pct)));
    };
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[3px] bg-white/[0.04]"
    >
      <div
        className="h-full origin-left bg-[#ccff00] shadow-[0_0_10px_rgba(204,255,0,0.55)] transition-[width] duration-100 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

export function LandingBackToTop() {
  const reduce = useReducedMotion();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        setVisible(window.scrollY > window.innerHeight * 0.6);
        raf = 0;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);

  const handleClick = () => {
    window.scrollTo({
      top: 0,
      behavior: reduce ? "auto" : "smooth",
    });
  };

  return (
    <AnimatePresence>
      {visible ? (
        <motion.button
          type="button"
          onClick={handleClick}
          aria-label="Back to top"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          whileTap={reduce ? undefined : { scale: 0.97 }}
          className="group fixed bottom-6 right-5 z-50 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-[#111114] text-white/70 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_10px_28px_-12px_rgba(0,0,0,0.6)] transition-[color,border-color,background-color] duration-200 hover:border-white/20 hover:bg-[#15151a] hover:text-white sm:bottom-8 sm:right-8"
        >
          <ChevronUp
            className="h-[18px] w-[18px] transition-transform duration-200 group-hover:-translate-y-0.5"
            strokeWidth={2}
            aria-hidden="true"
          />
          <span className="sr-only">Back to top</span>
        </motion.button>
      ) : null}
    </AnimatePresence>
  );
}
