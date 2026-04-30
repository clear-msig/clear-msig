"use client";

// App providers encapsulate query cache, wallet connection adapters,
// and the global toast surface.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { useMemo, useState } from "react";
import { solanaClusterRpc } from "@/lib/solana/cluster";
import { ToastProvider } from "@/components/ui/Toast";

type Props = {
  children: React.ReactNode;
};

export function AppProviders({ children }: Props) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 10_000,
            refetchOnWindowFocus: false
          }
        }
      })
  );

  // Solflare auto-registers via the Wallet Standard now, so wiring its
  // adapter explicitly causes a duplicate "Solflare" entry in the
  // selector. Phantom still needs an explicit adapter (its standard
  // wallet integration is partial in some browser builds).
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider endpoint={solanaClusterRpc}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>
            <ToastProvider>{children}</ToastProvider>
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </QueryClientProvider>
  );
}
