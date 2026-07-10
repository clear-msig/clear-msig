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
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { ToastProvider } from "@/components/ui/Toast";
import { validateConfig } from "@/lib/config";
import { applyTheme, getStoredTheme, watchSystemTheme } from "@/lib/security/theme";
import { LivePricesProvider } from "@/lib/retail/priceFeed";

type Props = {
  children: React.ReactNode;
};

const LazyDynamicProviderTree = dynamic(
  () => import("@/components/providers/DynamicProviderTree"),
  {
    ssr: false,
    loading: () => <WalletRuntimeLoading />,
  },
);

function needsWalletRuntime(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    pathname === "/connect" ||
    pathname === "/spike/dynamic" ||
    pathname === "/welcome" ||
    pathname === "/send" ||
    pathname.startsWith("/send/") ||
    pathname === "/app" ||
    pathname.startsWith("/app/")
  );
}

export function AppProviders({ children }: Props) {
  const configGaps = validateConfig();
  const pathname = usePathname();
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

  // System-theme watcher - when the user's preference is "system",
  // this listener re-applies the theme as the OS flips (e.g. macOS
  // auto dark/light schedule). Only matters for "system" mode; the
  // explicit "light"/"dark" choices ignore OS changes.
  useEffect(() => watchSystemTheme(), []);

  // Force-dark route enforcement for client-side navigation. The
  // <Script> in layout.tsx handles the initial load; this effect
  // handles route changes inside the SPA. Without it, a user with
  // stored "light" preference would navigate from /app/wallet
  // (light) into /welcome and see light surfaces around the
  // marketing dark chrome - a broken-theme look. applyTheme reads
  // the current pathname internally and short-circuits to "dark"
  // for the force-dark routes.
  useEffect(() => {
    applyTheme(getStoredTheme());
  }, [pathname]);

  if (configGaps.length > 0) {
    return <ConfigGapBanner gaps={configGaps} />;
  }

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

  const content = (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );

  if (!needsWalletRuntime(pathname)) return content;

  return (
    <QueryClientProvider client={queryClient}>
      {/* Mount prices only on product surfaces. Public/marketing pages
          no longer pay for wallet or price-feed runtime on first load. */}
      <LivePricesProvider />
      <LazyDynamicProviderTree environmentId={environmentId ?? ""}>
        <ToastProvider>{children}</ToastProvider>
      </LazyDynamicProviderTree>
    </QueryClientProvider>
  );
}

function WalletRuntimeLoading() {
  return (
    <main
      aria-label="Loading wallet"
      className="min-h-screen bg-canvas md:flex"
    >
      <aside className="hidden w-64 shrink-0 border-r border-border-soft bg-surface-raised md:block">
        <div className="space-y-4 p-5">
          <div className="h-8 w-28 animate-pulse rounded-soft bg-border-soft" />
          <div className="h-10 animate-pulse rounded-soft bg-border-soft/70" />
          <div className="h-10 animate-pulse rounded-soft bg-border-soft/70" />
          <div className="h-10 animate-pulse rounded-soft bg-border-soft/70" />
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="h-16 border-b border-border-soft bg-surface-raised md:h-14" />
        <div className="mx-auto w-full max-w-[76rem] space-y-4 px-4 py-6 sm:px-5 md:px-8 lg:px-10">
          <div className="h-7 w-48 animate-pulse rounded-soft bg-border-soft" />
          <div className="h-40 animate-pulse rounded-card border border-border-soft bg-surface-raised" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="h-28 animate-pulse rounded-card border border-border-soft bg-surface-raised" />
            <div className="h-28 animate-pulse rounded-card border border-border-soft bg-surface-raised" />
          </div>
        </div>
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
