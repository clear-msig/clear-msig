"use client";

import { ChainBadge } from "@/components/retail/ChainBadge";
import { CHAIN_CATALOG } from "@/lib/retail/chains";
import { chainAddress } from "@/lib/hooks/useWalletChains";
import type { ChainBindingResponse } from "@/lib/api/types";

export function RampChainPicker({
  bindings,
  selectedKind,
  disabled,
  onPickChain,
}: {
  bindings: ChainBindingResponse[];
  selectedKind: number | null;
  disabled: boolean;
  onPickChain: (kind: number) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-text-soft">
        Chain
      </legend>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {CHAIN_CATALOG.filter((chain) => chain.kind !== 4).map((chain) => {
          const binding = bindings.find((row) => row.chain_kind === chain.kind);
          const ready = Boolean(binding && chainAddress(binding) !== null);
          const selected = selectedKind === chain.kind;
          return (
            <button
              key={chain.kind}
              type="button"
              aria-pressed={selected}
              disabled={!ready || disabled}
              onClick={() => onPickChain(chain.kind)}
              className={`flex min-h-16 min-w-0 items-center gap-3 rounded-soft border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${selected ? "border-accent bg-accent/5 text-accent" : ready ? "border-border-soft bg-canvas/50 text-text-strong hover:border-border-strong" : "border-dashed border-border-soft text-text-soft"}`}
            >
              <ChainBadge chain={chain} size="sm" />
              <span className="min-w-0 text-xs font-medium">
                {chain.ticker}
                <span className="mt-1 block text-xs font-normal text-text-soft">
                  {ready ? (selected ? "Selected" : "Available") : "Not bound"}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
