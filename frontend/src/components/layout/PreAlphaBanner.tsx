"use client";

// Preview banner — retail rebuild.
//
// Pinned under the header on every /app/* route. Dismissible for the
// current tab session (sessionStorage — never suppresses permanently).
// Plain-language warning so non-technical users understand this is a
// preview. The "MPC mock signer · Ika pre-alpha · devnet" framing was
// retired with the retail pivot.

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";

const STORAGE_KEY = "clear-msig.preAlphaBanner.dismissed";

export function PreAlphaBanner() {
  // Start hidden to avoid a hydration flash; real state loads after
  // mount from sessionStorage.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const dismissed = sessionStorage.getItem(STORAGE_KEY) === "1";
      setVisible(!dismissed);
    } catch {
      // sessionStorage unavailable (private mode, SSR). Show by default.
      setVisible(true);
    }
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      sessionStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* noop */
    }
  };

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, height: 0, marginBottom: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          role="note"
          className="overflow-hidden"
        >
          <div className="mx-auto flex w-full max-w-[91rem] items-start gap-3 rounded-card border border-amber-400/40 bg-amber-100/60 px-4 py-3 text-amber-950 shadow-card-rest">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
            <div className="flex-1 text-xs leading-relaxed sm:text-sm">
              <span className="font-semibold">This is a preview.</span>{" "}
              Everything works, but it&rsquo;s running on a test network.
              Keep amounts small while we&rsquo;re still in early days.
            </div>
            <button
              onClick={dismiss}
              aria-label="Dismiss preview notice"
              className="rounded-full p-1 text-amber-700 transition-colors duration-base ease-out-soft hover:bg-amber-200/70"
            >
              <X size={14} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
