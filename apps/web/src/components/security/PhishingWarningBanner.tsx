"use client";

// Banner shown at the top of every /app/* surface when the host
// doesn't match the canonical allowlist. Designed to be impossible
// to miss without being modal - destroys legitimate work if a real
// alt-domain user can't dismiss it. So: dismissible per-tab via
// sessionStorage, but reappears on every fresh tab.
//
// Pair with /security page which teaches the bookmark habit. This
// is the runtime tripwire for users who've drifted away from the
// bookmark and ended up on a copycat.

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldAlert, X } from "lucide-react";
import {
  currentHost,
  expectedCanonicalHost,
  isCanonicalHost,
} from "@/lib/security/phishingGuard";

const DISMISS_KEY = "clear.phishing-banner.dismissed";

export function PhishingWarningBanner() {
  const [hydrated, setHydrated] = useState(false);
  const [show, setShow] = useState(false);
  const [host, setHost] = useState("");

  useEffect(() => {
    setHydrated(true);
    const onCanonical = isCanonicalHost();
    setHost(currentHost());
    if (onCanonical) {
      setShow(false);
      return;
    }
    let dismissed = false;
    try {
      dismissed = window.sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      /* sessionStorage blocked - show the banner anyway */
    }
    setShow(!dismissed);
  }, []);

  if (!hydrated || !show) return null;

  return (
    <div
      role="alert"
      className="rounded-card border border-warning/50 bg-warning/[0.08] p-3 shadow-card-rest"
    >
      <div className="flex items-start gap-3">
        <ShieldAlert
          className="mt-0.5 h-5 w-5 shrink-0 text-warning"
          strokeWidth={2}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1 text-xs">
          <p className="font-medium text-text-strong">
            You&rsquo;re on{" "}
            <span className="font-mono">{host || "an unknown domain"}</span>{" "}
            - not Clear&rsquo;s canonical site.
          </p>
          <p className="mt-1 text-text-soft">
            The official URL is{" "}
            <span className="font-mono text-text-strong">
              {expectedCanonicalHost()}
            </span>
            . If you didn&rsquo;t deliberately deploy on a custom domain,
            this could be a phishing copy - close the tab and re-open from
            your bookmark.
          </p>
          <Link
            href="/security"
            className="mt-2 inline-block text-xs font-medium text-accent hover:text-accent-hover"
          >
            How to verify Clear &rsaquo;
          </Link>
        </div>
        <button
          type="button"
          onClick={() => {
            setShow(false);
            try {
              window.sessionStorage.setItem(DISMISS_KEY, "1");
            } catch {
              /* ignore */
            }
          }}
          aria-label="Dismiss this warning for this tab"
          className="shrink-0 rounded-soft p-1 text-text-soft transition-colors hover:bg-canvas hover:text-text-strong"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
