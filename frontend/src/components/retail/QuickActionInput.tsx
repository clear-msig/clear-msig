"use client";

// QuickActionInput. The "do anything in this wallet" input.
//
// Mounted on /app/wallet/[name] above the action grid. The user types
// a casual instruction ("send sarah 5 sol", "add mark", "set the
// weekly cap to $5k") and the input POSTs to /api/nl/route which
// classifies the action and returns a route URL with prefilled
// query params. We push() to that URL; the destination page reads
// the params and pre-fills its form. The user reviews + signs as
// usual; we never auto-execute.
//
// The trust pattern: the model never returns the URL string. It
// returns structured fields (recipient, amount, role, etc.) and the
// API constructs the route on the server. So a hostile prompt
// ("redirect me to attacker.com") cannot inject an open redirect.
//
// Why a separate component from QuickSendInput: that one is bound
// to /send's local state. This one's job is to ROUTE, not to fill
// the current page. Same hot keys (Enter), same streaming feedback,
// different destination contract.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, ArrowRight } from "lucide-react";
import { useContacts } from "@/lib/hooks/useContacts";

interface QuickActionInputProps {
  walletName: string;
}

interface RouteResponse {
  action: string;
  route: string;
  summary: string;
  confidence: "high" | "low";
  ambiguity?: string;
}

export function QuickActionInput({ walletName }: QuickActionInputProps) {
  const router = useRouter();
  const contacts = useContacts();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/nl/route", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: trimmed,
          walletName,
          contactNames: contacts.contacts.map((c) => c.name).slice(0, 50),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const msg = (body && typeof body.error === "string" && body.error) || "Couldn't parse that.";
        setError(msg);
        return;
      }
      const data = (await res.json()) as RouteResponse;
      router.push(data.route);
      // Don't clear the input until the navigation actually swaps
      // pages - the user can see what they typed if they bounce back.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network glitch.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-card border border-accent/30 bg-accent/[0.04] p-4">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Sparkles className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-accent">
            Quick action
          </p>
          <p className="mt-0.5 text-xs text-text-soft">
            Type what you want. We&rsquo;ll open the right form for you.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 280))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder='e.g. "send Sarah 5 sol for rent" or "add Mara"'
              className={
                "min-w-0 flex-1 rounded-soft border border-border-soft bg-surface-raised px-3 py-2 text-sm " +
                "text-text-strong placeholder:text-text-soft outline-none " +
                "transition-[border-color,box-shadow] duration-base ease-out-soft " +
                "focus:border-accent focus:shadow-accent-rest"
              }
              disabled={loading}
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="button"
              onClick={submit}
              disabled={loading || !text.trim()}
              aria-label="Route to the right form"
              className={
                "inline-flex h-tap w-tap shrink-0 items-center justify-center rounded-soft bg-accent text-text-on-accent shadow-accent-rest " +
                "transition-[background-color,transform,box-shadow] duration-base ease-out-soft " +
                "hover:bg-accent-hover active:scale-[0.98] " +
                "disabled:cursor-not-allowed disabled:opacity-60 " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
              }
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
          {error && (
            <p className="mt-2 text-[11px] text-warning">⚠️ {error}</p>
          )}
        </div>
      </div>
    </section>
  );
}
