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
import { needsWalletRuntime } from "@/features/wallet-runtime/domain/routePolicy";
import { ConfigGapBanner, WalletRuntimeLoading } from "@/features/wallet-runtime/ui/RuntimeStates";
import {
  EXTERNAL_WALLET_RUNTIME_EVENT,
  EXTERNAL_WALLET_RUNTIME_KEY,
} from "@/features/wallet-runtime/domain/runtimePreference";
import { validateConfig } from "@/lib/config";
import { applyTheme, getStoredTheme, watchSystemTheme } from "@/lib/security/theme";

type Props = {
  children: React.ReactNode;
};

const LazyDynamicProviderTree = dynamic(
  () => import("@/features/wallet-runtime/infrastructure/DynamicProviderTree"),
  {
    ssr: false,
    loading: () => <WalletRuntimeLoading />,
  },
);

const LazyExternalDynamicProviderTree = dynamic(
  () =>
    import(
      "@/features/wallet-runtime/infrastructure/ExternalDynamicProviderTree"
    ),
  {
    ssr: false,
    loading: () => <WalletRuntimeLoading />,
  },
);

const LazyLivePricesProvider = dynamic(
  () => import("@/lib/retail/priceFeed").then((mod) => mod.LivePricesProvider),
  {
    ssr: false,
    loading: () => null,
  },
);

const LazyPublicAuthRedirectBoundary = dynamic(
  () => import("@/components/providers/PublicAuthRedirectBoundary"),
  { ssr: false, loading: () => <WalletRuntimeLoading /> },
);

function needsPublicAuthRedirect(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    pathname === "/choose" ||
    pathname === "/personal" ||
    pathname === "/pro" ||
    pathname === "/agent" ||
    pathname === "/secure" ||
    pathname === "/p2pdefi" ||
    pathname === "/payments" ||
    pathname === "/privacy" ||
    pathname === "/security" ||
    pathname === "/changelog" ||
    pathname === "/agents" ||
    pathname.startsWith("/agents/")
  );
}

export function AppProviders({ children }: Props) {
  const configGaps = validateConfig();
  const pathname = usePathname();
  const [externalWalletRuntime, setExternalWalletRuntime] = useState(false);
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

  useEffect(() => {
    const refresh = () => {
      const injected = window as typeof window & {
        backpack?: unknown;
        phantom?: { solana?: unknown };
        solana?: unknown;
        solflare?: unknown;
      };
      const stored =
        window.localStorage.getItem(EXTERNAL_WALLET_RUNTIME_KEY) === "1";
      const hasInjectedWallet = Boolean(
        injected.backpack ||
          injected.phantom?.solana ||
          injected.solana ||
          injected.solflare,
      );
      setExternalWalletRuntime(stored || hasInjectedWallet);
    };
    refresh();
    window.addEventListener(EXTERNAL_WALLET_RUNTIME_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(EXTERNAL_WALLET_RUNTIME_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

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

  const publicAuthRedirect = needsPublicAuthRedirect(pathname);
  const WalletProvider =
    pathname === "/connect" || externalWalletRuntime
      ? LazyExternalDynamicProviderTree
      : LazyDynamicProviderTree;

  const content = publicAuthRedirect ? (
    <QueryClientProvider client={queryClient}>
      <WalletProvider environmentId={environmentId ?? ""}>
        <ToastProvider>
          <LazyPublicAuthRedirectBoundary>
            {children}
          </LazyPublicAuthRedirectBoundary>
        </ToastProvider>
      </WalletProvider>
    </QueryClientProvider>
  ) : (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );

  if (!needsWalletRuntime(pathname)) return content;

  return (
    <QueryClientProvider client={queryClient}>
      {/* Mount prices only on product surfaces. Public/marketing pages
          no longer pay for wallet or price-feed runtime on first load. */}
      <LazyLivePricesProvider />
      <WalletProvider environmentId={environmentId ?? ""}>
        <ToastProvider>{children}</ToastProvider>
      </WalletProvider>
    </QueryClientProvider>
  );
}
