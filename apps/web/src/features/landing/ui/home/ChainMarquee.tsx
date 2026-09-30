import { CHAINS } from "@/components/landing/ChainLogos";

// A quiet, finite network list is easier to scan than a repeating ticker.
export function ChainMarquee() {
  const chains = CHAINS.filter((chain) => ["sol", "eth", "btc", "zec", "hyperliquid"].includes(chain.key));
  return (
    <section aria-label="Supported networks" className="border-y border-border-soft px-5 py-7 sm:px-10">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="shrink-0 text-xs font-medium text-text-soft">One place. Multiple networks.</p>
        <ul className="flex flex-wrap items-center gap-x-7 gap-y-4">
          {chains.map(({ key, label, Logo }) => <li key={key} className="flex items-center gap-2 text-xs text-text-soft"><Logo size={20} className="h-5 w-5 opacity-80" /><span>{label}</span></li>)}
        </ul>
      </div>
    </section>
  );
}
