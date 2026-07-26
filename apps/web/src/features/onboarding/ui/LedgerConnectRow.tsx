"use client";

import { Check, Loader2, Usb } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useLedgerPresence } from "@/lib/hooks/useLedgerPresence";
import { useLedger } from "@/lib/wallet/LedgerProvider";

/** Secondary hardware-wallet entry, loaded after the primary auth surface. */
export function LedgerConnectRow() {
  const ledger = useLedger();
  const toast = useToast();
  const presence = useLedgerPresence();

  const handleClick = async () => {
    try {
      await ledger.connect();
      toast.success("Ledger connected. Signing routes through your device now.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not connect Ledger",
      );
    }
  };

  if (ledger.session) {
    return (
      <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-[#ccff00]/40 bg-[#ccff00]/[0.06] p-3 text-xs text-white backdrop-blur-md">
        <span className="inline-flex items-center gap-2">
          <Check
            className="h-4 w-4 text-[#ccff00]"
            strokeWidth={2.25}
            aria-hidden="true"
          />
          <span className="text-[12px] leading-snug">
            Ledger connected. Your device will show the full message when you
            sign.
          </span>
        </span>
        <button
          type="button"
          onClick={() => ledger.disconnect()}
          className="rounded-full px-2.5 py-1 font-mono-tech text-[10px] uppercase tracking-[0.24em] text-white/60 transition-colors duration-200 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ccff00]/50"
        >
          Disconnect
        </button>
      </div>
    );
  }

  if (!presence.supported) return null;

  if (presence.detected) {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={ledger.connecting}
        className="mt-5 flex w-full items-center justify-between gap-3 rounded-2xl border border-[#ccff00]/40 bg-[#ccff00]/[0.06] p-3 text-left text-xs backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:border-[#ccff00] hover:bg-[#ccff00]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ccff00]/50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="inline-flex items-center gap-2">
          <Usb
            className="h-4 w-4 text-[#ccff00]"
            strokeWidth={2.25}
            aria-hidden="true"
          />
          <span className="flex flex-col">
            <span className="text-[13px] font-medium text-white">
              Ledger detected
            </span>
            <span className="font-mono-tech text-[10px] uppercase tracking-[0.24em] text-white/50">
              Sign with your hardware wallet
            </span>
          </span>
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-[#ccff00] px-3 py-1 text-[11px] font-bold text-black shadow-[0_0_18px_rgba(204,255,0,0.35)]">
          {ledger.connecting ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              Connecting...
            </>
          ) : (
            "Connect"
          )}
        </span>
      </button>
    );
  }

  return (
    <div className="mt-5">
      <button
        type="button"
        onClick={handleClick}
        disabled={ledger.connecting}
        className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-border-strong bg-glass-soft px-4 py-2.5 font-mono-tech text-[10px] uppercase tracking-[0.24em] text-white/60 backdrop-blur-md transition-[color,background-color,border-color] duration-200 hover:border-[#ccff00]/50 hover:bg-[#ccff00]/[0.08] hover:text-[#ccff00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ccff00]/50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {ledger.connecting ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Waiting for your Ledger
          </>
        ) : (
          <>
            <Usb className="h-3.5 w-3.5" aria-hidden="true" />
            Use a hardware wallet instead
          </>
        )}
      </button>
    </div>
  );
}
