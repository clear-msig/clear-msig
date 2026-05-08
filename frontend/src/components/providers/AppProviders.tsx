"use client";

// App providers: query cache, Dynamic auth + wallet, global toast.
//
// Dynamic replaces the old @solana/wallet-adapter setup. It handles
// both onboarding paths in one provider:
//   - Email / social signup mints a TSS-MPC embedded Solana wallet
//     on the fly (the retail story).
//   - External wallets (Phantom / Solflare / Backpack) auto-discover
//     via Dynamic's wallet-standard support.
//
// The 30+ files that imported from @solana/wallet-adapter-react now
// import from @/lib/wallet, a thin shim that exposes useWallet()
// and useConnection() with the same shape, backed by Dynamic. The
// swap was an import path change in those files, no logic changes.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import dynamic from "next/dynamic";
import { ToastProvider } from "@/components/ui/Toast";
import { validateConfig } from "@/lib/config";

// Dynamic Labs SDK + connectors + LedgerProvider live in their own
// chunk so the initial layout bundle doesn't ship them. We render a
// minimal shell while the chunk loads — about one frame on prod —
// then the auth provider takes over. ssr:false because all the
// connectors touch browser-only globals.
const DynamicProviderTree = dynamic(
  () => import("@/components/providers/DynamicProviderTree"),
  {
    ssr: false,
    loading: () => <ProvidersLoadingShell />,
  },
);

type Props = {
  children: React.ReactNode;
};

export function AppProviders({ children }: Props) {
  const configGaps = validateConfig();
  if (configGaps.length > 0) {
    return <ConfigGapBanner gaps={configGaps} />;
  }
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Tight retry so failures surface fast instead of slow
            // stalls on a flaky RPC.
            retry: 1,
            // Wider staleTime + gcTime: the same wallet, memberships,
            // and intent data are read across half the pages. Without
            // a longer cache window, every nav triggered a round-trip
            // and made the app feel laggy. 60s stale + 5min gc keeps
            // it snappy without showing badly stale balances.
            staleTime: 60_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            // Reuse last-known data while the next fetch runs so
            // navigation between cached pages doesn't flash skeletons.
            refetchOnMount: false,
            refetchOnReconnect: false,
          },
        },
      }),
  );

  const environmentId = process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID;

  // Hard fail in development if the env id is missing; on production
  // this is impossible to recover from gracefully and a clear error
  // beats a confused-looking empty wallet picker.
  if (!environmentId) {
    if (typeof window !== "undefined") {
      console.error(
        "[AppProviders] NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID is not set. " +
          "Get one from https://app.dynamic.xyz and add it to .env.local.",
      );
    }
  }

  return (
    <QueryClientProvider client={queryClient}>
      <DynamicProviderTree environmentId={environmentId ?? ""}>
        <ToastProvider>{children}</ToastProvider>
      </DynamicProviderTree>
    </QueryClientProvider>
  );
}

// Mount target while the Dynamic chunk loads. Used to be a blank
// canvas, which gave /welcome and /connect a "frozen" feel for the
// 200-800ms the chunk takes to land — the user taps Get started,
// the page goes black, nothing moves, then the wizard pops in.
//
// Updated 2026-05-08: render the brand mark + a single accent
// hairline + an animated ring so the user sees motion immediately.
// The ring isn't a scolding spinner, it's a calm "we're booting"
// signal that matches the app's other waiting states (BrandLoader
// is the canonical one). No layout shift when the real tree
// hydrates because both states center inside min-h-screen.
function ProvidersLoadingShell() {
  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-6 bg-canvas px-gutter font-sans"
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="relative h-10 w-10">
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-accent/15"
        />
        <span
          aria-hidden="true"
          className="absolute inset-0 animate-spin rounded-full border-2 border-accent border-t-transparent"
        />
      </div>
      <div className="flex flex-col items-center text-center">
        <span aria-hidden="true" className="block h-px w-10 bg-accent" />
        <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
          Booting Clear
        </p>
      </div>
    </main>
  );
}

// ─── Production misconfiguration screen ───────────────────────────
//
// When a NEXT_PUBLIC_ var the production deploy depends on is
// missing, the silent failure mode (calls to localhost, an empty
// Dynamic widget) is much worse than a fatal banner. This screen
// ships in place of the app and lists exactly what's missing + why.
// Renders only in NODE_ENV === "production"; dev hacking is unaffected.

function ConfigGapBanner({
  gaps,
}: {
  gaps: ReturnType<typeof validateConfig>;
}) {
  return (
    <main className="min-h-screen bg-canvas px-gutter py-12">
      <div className="mx-auto max-w-xl rounded-card border border-danger/40 bg-danger/[0.05] p-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-danger">
          This deployment is misconfigured
        </p>
        <h1 className="mt-2 font-display text-display-xs text-text-strong">
          {gaps.length === 1 ? "1 environment variable" : `${gaps.length} environment variables`}{" "}
          missing
        </h1>
        <p className="mt-2 text-sm text-text-soft">
          The production build started without the required configuration.
          Set the variables below in the Vercel project settings and
          redeploy.
        </p>
        <ul className="mt-4 flex flex-col gap-3">
          {gaps.map((g) => (
            <li
              key={g.envVar}
              className="rounded-soft border border-border-soft bg-surface-raised p-3"
            >
              <code className="font-mono text-sm font-medium text-text-strong">
                {g.envVar}
              </code>
              <p className="mt-1 text-xs text-text-soft">{g.why}</p>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
