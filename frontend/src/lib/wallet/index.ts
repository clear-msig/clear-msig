"use client";

// Wallet shim. Mirrors the @solana/wallet-adapter-react surface so the
// 30+ files that called useWallet() / useConnection() do not need to
// change their imports beyond swapping the package path.
//
// What changed underneath: the auth provider is now Dynamic, which
// handles BOTH email/social signup (embedded wallets via TSS-MPC) AND
// external wallets (Phantom, Solflare, Backpack) through its own
// connector system. The shim normalises Dynamic's primaryWallet API
// down to the {publicKey, connected, signMessage} shape the rest of
// the codebase already speaks.
//
// Migration was an import swap, not a rewrite. The 30+ call sites
// kept the same `useWallet()` / `useConnection()` signatures; only
// the import path changed. (The original imports came from
// @solana/wallet-adapter-react, which is no longer used.)
//
// What's intentionally NOT shimmed:
//   - sendTransaction / signTransaction. Clear's signed-write path
//     uses signMessage exclusively; if a future flow needs to submit
//     a transaction through the user's wallet, add it here.
//   - WalletProvider, ConnectionProvider, WalletModalProvider — those
//     are replaced by DynamicContextProvider in AppProviders.

import { useCallback, useMemo } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { useDynamicContext, useUserWallets } from "@dynamic-labs/sdk-react-core";
import { isSolanaWallet } from "@dynamic-labs/solana-core";
import { solanaClusterRpc } from "@/lib/solana/cluster";
import { useLedger } from "@/lib/wallet/LedgerProvider";

/// Drop-in replacement for `useWallet()` from @solana/wallet-adapter-react.
/// Returns a Solana wallet view derived from Dynamic's primary wallet,
/// or any Solana wallet attached to the logged-in user. signMessage
/// resolves the embedded-wallet signer lazily on each call so the
/// returned signature is ed25519 over the bytes we passed in.
///
/// When a Ledger session exists (set up via `<LedgerProvider>` and
/// the connect button on /connect), it takes precedence over Dynamic
/// for both the surfaced public key and signMessage. Routing all
/// signing through the device is what earns the "clear signing"
/// claim — the Solana app on the Ledger renders the offchain message
/// body as text on the device screen rather than hex in a popup.
export function useWallet() {
  const { primaryWallet, handleLogOut, sdkHasLoaded } = useDynamicContext();
  const allWallets = useUserWallets();
  const ledger = useLedger();

  // Prefer the active wallet when it's Solana; otherwise grab any
  // Solana wallet the user has minted (e.g. they logged in via email,
  // primary is EVM, but a Solana embedded wallet was also minted).
  const solanaWallet = useMemo(() => {
    if (primaryWallet && isSolanaWallet(primaryWallet)) return primaryWallet;
    return allWallets.find((w) => w && isSolanaWallet(w)) ?? null;
  }, [primaryWallet, allWallets]);

  const dynamicPublicKey = useMemo(() => {
    if (!solanaWallet?.address) return null;
    try {
      return new PublicKey(solanaWallet.address);
    } catch {
      return null;
    }
  }, [solanaWallet]);

  // Detect signers that cannot sign clear-msig's offchain-wrapped
  // messages. Two known cases:
  //
  //   "waas"    — Dynamic's WaaS-SVM connector. Its signMessage decodes
  //               the input bytes as UTF-8 (Buffer.from(bytes).toString())
  //               before signing, which corrupts our envelope's leading
  //               `\xff` byte. Caught by the local ed25519 verify in
  //               useSignWithWallet (the signature is over different
  //               bytes than we asked for).
  //
  //   "phantom" — Phantom. Per docs.phantom.com/solana/signing-a-message,
  //               signMessage only accepts UTF-8 or hex-encoded strings.
  //               Phantom's transaction-detection heuristic refuses bytes
  //               starting with `\xff` (interprets it as `0x80 | version`
  //               versioned-tx prefix) and throws "You cannot sign solana
  //               transactions using sign message". The offchain-message
  //               magic prefix the Solana spec mandates IS that `\xff`,
  //               so Phantom currently rejects every clear-msig payload.
  //
  // Consumers gate banners and CTAs on `signerIssue` so users see the
  // explanation before the failed sign.
  const signerIssue = useMemo<"waas" | "phantom" | null>(() => {
    if (ledger.session) return null; // Ledger always wins.
    if (!solanaWallet) return null;
    // Duck-type the connector identifier; the SDK's WalletConnector type
    // doesn't expose `overrideKey` in its public types but the value is
    // set at runtime (e.g. 'dynamicwaas' on the WaaS connector).
    const c = (solanaWallet as unknown as { connector?: { key?: string; name?: string; overrideKey?: string } }).connector;
    if (!c) return null;
    const id = (c.key ?? c.overrideKey ?? c.name ?? "").toLowerCase();
    if (/dynamicwaas/.test(id)) return "waas";
    if (/phantom/.test(id)) return "phantom";
    return null;
  }, [solanaWallet, ledger.session]);

  const isUnsupportedSigner = signerIssue !== null;

  const ledgerPublicKey = useMemo(() => {
    if (!ledger.session) return null;
    try {
      return new PublicKey(ledger.session.pubkeyBase58);
    } catch {
      return null;
    }
  }, [ledger.session]);

  // Ledger always wins when connected. The whole point is that the
  // device, not the embedded wallet, signs.
  const publicKey = ledgerPublicKey ?? dynamicPublicKey;
  const connected = !!publicKey && (!!ledger.session || !!solanaWallet);

  const signMessage = useCallback(
    async (bytes: Uint8Array): Promise<Uint8Array> => {
      if (ledger.session) {
        // Ledger expects the offchain-wrapped buffer verbatim. The
        // caller passes exactly that (via `wrapOffchain`); the device
        // recognises the magic prefix and renders the body as text.
        return ledger.session.signOffchainMessage(bytes);
      }
      if (!solanaWallet) {
        throw new Error("Connect a wallet before signing");
      }
      const signer = await solanaWallet.getSigner();
      const result = await signer.signMessage(bytes);
      // Dynamic returns either Uint8Array directly or {signature: ...}
      // depending on connector version; normalise.
      if (result instanceof Uint8Array) return result;
      const sig = (result as { signature?: Uint8Array })?.signature;
      if (!(sig instanceof Uint8Array)) {
        throw new Error("Wallet returned an unexpected signMessage shape");
      }
      return sig;
    },
    [solanaWallet, ledger.session],
  );

  const disconnect = useCallback(async () => {
    if (ledger.session) {
      await ledger.disconnect();
    }
    await handleLogOut();
  }, [handleLogOut, ledger]);

  return {
    publicKey,
    connected,
    signMessage: connected ? signMessage : undefined,
    disconnect,
    /// True while the Dynamic SDK is still booting. wallet-adapter
    /// called this `connecting`; the gate uses it to avoid bouncing
    /// in-flight authentication on first paint.
    connecting: !sdkHasLoaded,
    /// Always false. wallet-adapter exposed `disconnecting` for the
    /// brief window between disconnect-call and disconnect-event.
    /// Dynamic's logout is fire-and-forget; nothing depends on this
    /// being true so we keep the shape compatible with `false`.
    disconnecting: false,
    /// True if the user is logged into Dynamic but no Solana wallet
    /// has been minted yet. Lets callers distinguish "not logged in"
    /// from "logged in but no Solana wallet" for clearer UX.
    loggedInWithoutSolana: !!primaryWallet && !solanaWallet && !ledger.session,
    /// True when signing routes through a Ledger device (signOffchain
    /// shows full text on the screen). Consumers use this to swap
    /// "your wallet shows hex" copy for "your Ledger shows the full
    /// message". See `<WalletPopupNarration>`.
    isLedger: !!ledger.session,
    /// True when the active signer cannot sign clear-msig's offchain-
    /// wrapped messages. Render an upfront "use a different wallet"
    /// banner so users don't hit a doomed signing flow. See
    /// `<UnsupportedSignerBanner>`.
    isUnsupportedSigner,
    /// Backward-compat alias for `isUnsupportedSigner`. New code should
    /// use `signerIssue` for richer copy.
    isLossySigner: isUnsupportedSigner,
    /// Discriminator for which incompatibility we hit. `null` means the
    /// signer works. `<UnsupportedSignerBanner>` switches copy on this
    /// (Phantom's tx heuristic vs WaaS's UTF-8 corruption are different
    /// causes and deserve different explanations).
    signerIssue,
  };
}

// Single shared Solana connection. Wallet-adapter's ConnectionProvider
// would have given each component an instance via context; we cache one
// at module scope since the RPC URL is static. Memoise per-component to
// keep the same referential identity react-query expects.
const sharedConnection = new Connection(solanaClusterRpc, "confirmed");

/// Drop-in replacement for `useConnection()` from
/// @solana/wallet-adapter-react. Returns the same `{connection}` shape.
export function useConnection() {
  return useMemo(() => ({ connection: sharedConnection }), []);
}
