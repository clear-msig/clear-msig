"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/retail/Button";

export function SendErrorBanner({
  error,
  onReset,
  onDismiss,
}: {
  error: { title: string; body: string; stderr?: string };
  onReset: () => void;
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div role="alert" className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-text-strong">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="font-semibold">{error.title}</p>
          <p className="mt-1 text-text-soft">{error.body}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="-mr-1 -mt-1 rounded-md p-1 text-text-soft hover:text-text-strong"
          aria-label="Dismiss error"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {error.stderr && (
        <details
          className="mt-3 text-xs"
          open={expanded}
          onToggle={(event) => setExpanded((event.target as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer text-text-soft hover:text-text-strong">Details</summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-text-soft">
            {error.stderr.trim()}
          </pre>
        </details>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onReset}>Try again</Button>
        {error.stderr && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void navigator.clipboard.writeText(error.stderr ?? "").catch(() => undefined)}
          >
            Copy details
          </Button>
        )}
      </div>
    </div>
  );
}
