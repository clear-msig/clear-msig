"use client";

// Wallet gate - centralized routing on connection state.
//
// Protected routes (/app/**, /welcome/**, /send) require a connected
// wallet. Unconnected visitors are bounced to /connect with a `next`
// query param so they land back where they meant to go after connecting.
// /send/** is kept protected only so the legacy redirect (now living
// at app/send/page.tsx) waits for a connection before forwarding to
// the canonical /app/wallet/[name]/send path.
//
// Connected visitors on / or /connect are forwarded into the app
// shell. Explicit product/deep-link `next` destinations are preserved
// through login; generic login falls back to the product chooser for
// first-timers and the wallet hub for returning users.
//
// The membership query only fires on /connect, so consumers on other
// pages don't pay an extra RPC. React-query dedupes by query key so
// the dashboard's own memberships fetch shares this cache.

import { useEffect, useMemo } from "react";
import { useWallet } from "@/lib/wallet";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { fetchOnchainMemberships } from "@/lib/memberships/client";
import {
  isProductSurfaceId,
  productWorkspaceHref,
} from "@/lib/productSurfaces";
import {
  clearPendingProductSurface,
  productSurfaceFromPath,
  readPendingProductSurface,
  readSelectedProductSurface,
  saveSelectedProductSurface,
} from "@/lib/productSession";

const PROTECTED_PREFIXES = ["/app", "/welcome", "/send"];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function useWalletGate() {
  const wallet = useWallet();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const address = wallet.publicKey?.toBase58() ?? "";
  const explicitNext = useMemo(() => {
    if (pathname !== "/connect") return null;
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");
    return isSafeNext(next) ? next : null;
  }, [pathname]);
  const explicitSurface = useMemo(() => {
    if (pathname !== "/connect") return null;
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const surface = params.get("surface");
    return isProductSurfaceId(surface) ? surface : null;
  }, [pathname]);

  // Only need the memberships count on /connect to pick the post-
  // connect destination. Same queryKey as the dashboard's fetch so
  // react-query reuses the cache once the user lands.
  const memberships = useQuery({
    queryKey: ["my-organizations", address],
    queryFn: () => fetchOnchainMemberships(address),
    enabled:
      address.length > 0 &&
      pathname === "/connect" &&
      wallet.connected &&
      explicitNext === null,
    staleTime: 30_000,
  });

  useEffect(() => {
    // autoConnect lands an in-flight connection on first paint. Without
    // this guard the gate sees connected=false and bounces shareable
    // deep links to /connect before the adapter resolves.
    if (wallet.connecting || wallet.disconnecting) return;

    // Dynamic edge case: the user has logged in via email/social but
    // no Solana wallet has been minted yet (TSS-MPC takes a beat
    // after first verify, or the dashboard's Embedded Wallets →
    // Solana toggle is off). Without this guard /welcome would bounce
    // to /connect, /connect would see them as "logged in" and not
    // know what to do, and they'd loop. Stay on the current page;
    // /connect's DynamicWidget will render its own status, and
    // /welcome (and other gates) render a NeutralWait that resolves
    // once the Solana wallet appears.
    if (wallet.loggedInWithoutSolana) return;

    if (wallet.connected) {
      if (pathname === "/connect") {
        if (explicitNext) {
          const nextSurface = productSurfaceFromPath(explicitNext) ?? explicitSurface;
          if (nextSurface) {
            saveSelectedProductSurface(nextSurface, address);
            clearPendingProductSurface();
          }
          router.replace(explicitNext);
          return;
        }
        // Wait for the memberships query to settle so we don't flash
        // to /welcome before discovering existing wallets.
        if (memberships.isLoading || memberships.isFetching) return;
        const hasWallets = (memberships.data?.length ?? 0) > 0;
        const pendingSurface = explicitSurface ?? readPendingProductSurface();
        if (pendingSurface) {
          saveSelectedProductSurface(pendingSurface, address);
          clearPendingProductSurface();
        }
        if (hasWallets) {
          // Already onboarded - honor an explicit product/deep-link
          // destination, but do not let stale generic /welcome links
          // push returning users back through a duplicate create flow.
          const fallbackSurface =
            pendingSurface ?? readSelectedProductSurface(address);
          const fallback = fallbackSurface
            ? productWorkspaceHref(fallbackSurface)
            : "/app/wallet";
          router.replace(fallback);
        } else {
          // First-timer - honor ?next, fall back to the product
          // chooser so they pick intent before creating anything.
          // Open-redirect hardening: require single leading "/", reject
          // protocol-relative ("//attacker.com") + scheme-prefixed
          // ("javascript:..."), and reject anything containing ":".
          // Without these gates an attacker crafts /connect?next=//evil
          // and gets the user dropped on evil.com after sign-in.
          router.replace(
            pendingSurface ? productWorkspaceHref(pendingSurface) : "/choose",
          );
        }
        return;
      }
      if (pathname === "/") {
        const pendingSurface = readPendingProductSurface();
        if (pendingSurface) {
          saveSelectedProductSurface(pendingSurface, address);
          clearPendingProductSurface();
        }
        const fallbackSurface =
          pendingSurface ?? readSelectedProductSurface(address);
        router.replace(
          fallbackSurface ? productWorkspaceHref(fallbackSurface) : "/app/wallet",
        );
        return;
      }
      return;
    }

    if (isProtected(pathname)) {
      const query =
        typeof window !== "undefined"
          ? window.location.search.replace(/^\?/, "")
          : "";
      const next = `${pathname}${query ? `?${query}` : ""}`;
      router.replace(`/connect?next=${encodeURIComponent(next)}`);
    }
  }, [
    wallet.connected,
    wallet.connecting,
    wallet.disconnecting,
    wallet.loggedInWithoutSolana,
    address,
    explicitNext,
    explicitSurface,
    pathname,
    router,
    memberships.isLoading,
    memberships.isFetching,
    memberships.data,
  ]);

  return {
    connected: wallet.connected,
    publicKey: wallet.publicKey?.toBase58() ?? null,
    /// Surfaced from the wallet shim so consumers can render a
    /// "minting your Solana wallet" wait state instead of "taking
    /// you to connect" when Dynamic auth completed but the Solana
    /// embedded wallet hasn't been provisioned yet.
    loggedInWithoutSolana: wallet.loggedInWithoutSolana,
  };
}

/// Open-redirect guard for ?next= values supplied by /connect's
/// query string. Accepts only single-leading-slash same-origin
/// paths. Rejects:
///   - null / empty
///   - protocol-relative URLs ("//evil.com" - would route to evil.com
///     because router.replace treats it as a host-relative URL)
///   - scheme-prefixed URLs ("javascript:...", "data:...", "https:...")
///   - any path containing ":" before the first "/" (custom schemes)
function isSafeNext(next: string | null): boolean {
  if (!next) return false;
  if (next.length === 0 || next.length > 200) return false;
  if (!next.startsWith("/")) return false;
  if (next.startsWith("//")) return false;
  if (next.startsWith("/\\")) return false; // Windows-style escape
  // No colon allowed anywhere in the first segment - blocks
  // "javascript:" tucked inside encoded query params, etc.
  const firstSlash = next.indexOf("/", 1);
  const firstSegment = firstSlash === -1 ? next : next.slice(0, firstSlash);
  if (firstSegment.includes(":")) return false;
  return true;
}
