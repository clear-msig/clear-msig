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
//   - WalletProvider, ConnectionProvider, WalletModalProvider - those
//     are replaced by DynamicContextProvider in AppProviders.

import { useCallback, useMemo } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { useDynamicContext, useUserWallets } from "@dynamic-labs/sdk-react-core";
import { isSolanaWallet } from "@dynamic-labs/solana-core";
import { createSolanaConnection } from "@/lib/solana/cluster";
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
/// claim - the Solana app on the Ledger renders the offchain message
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
  // messages. One known case today:
  //
  //   "waas"    - Dynamic's WaaS-SVM connector. Its signMessage decodes
  //               the input bytes as UTF-8 (Buffer.from(bytes).toString())
  //               before signing, which corrupts our envelope's leading
  //               `\xff` byte. Caught by the local ed25519 verify in
  //               useSignWithWallet (the signature is over different
  //               bytes than we asked for).
  //
  // Consumers gate banners and CTAs on `signerIssue` so users see the
  // explanation before the failed sign.
  const signerIssue = useMemo<"waas" | null>(() => {
    if (ledger.session) return null; // Ledger always wins.
    if (!solanaWallet) return null;
    // Duck-type the connector identifier; the SDK's WalletConnector type
    // doesn't expose `overrideKey` in its public types but the value is
    // set at runtime (e.g. 'dynamicwaas' on the WaaS connector).
    const c = (solanaWallet as unknown as { connector?: { key?: string; name?: string; overrideKey?: string } }).connector;
    if (!c) return null;
    const id = (c.key ?? c.overrideKey ?? c.name ?? "").toLowerCase();
    if (/dynamicwaas/.test(id)) return "waas";
    return null;
  }, [solanaWallet, ledger.session]);

  const walletConnectorKey = useMemo(() => {
    if (!solanaWallet) return "";
    const c = (solanaWallet as unknown as { connector?: { key?: string; name?: string; overrideKey?: string } }).connector;
    if (!c) return "";
    return (c.key ?? c.overrideKey ?? c.name ?? "").toLowerCase();
  }, [solanaWallet]);
  const isPhantomWallet = /phantom/.test(walletConnectorKey);

  // Mobile in-app browser detection. On desktop, Phantom + Solflare
  // extensions decode signMessage bytes and render the body as text in
  // their confirm modal. On mobile in-app browsers, the same bytes
  // render as raw hex — same payload, different wallet renderer.
  // Consumers (WalletPopupNarration) use this to swap the disclaimer
  // copy from "technical text is normal" to "your wallet will show
  // hex; verify the preview above".
  const isMobile = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
    [],
  );

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

  // Choose the right signer for a wallet whose approver list we know.
  //
  // The bug this solves: a user creates a multisig with their Dynamic
  // embedded pubkey D in the approvers list, then later connects a
  // Ledger with pubkey L. `useWallet().publicKey` then defaults to L
  // (Ledger preferred), so every signed action signs with L - but L
  // isn't in the wallet's approver list, so the on-chain ed25519
  // verify fails with a confusing error and the user can't sign at
  // all. Symmetric problem the other way (wallet with L approvers,
  // user accidentally has Dynamic active too). `pickSigner` resolves
  // to whichever pubkey we hold that's actually in the approver
  // list, prefering Ledger when both match. Returns null when
  // neither pubkey is in approvers - the caller should surface a
  // clear "this wallet isn't signable from your current connection"
  // error rather than letting the on-chain verify fail.
  const pickSigner = useCallback(
    (approvers: readonly string[]): PublicKey | null => {
      const ledgerB58 = ledgerPublicKey?.toBase58();
      const dynamicB58 = dynamicPublicKey?.toBase58();
      if (ledgerB58 && approvers.includes(ledgerB58)) return ledgerPublicKey;
      if (dynamicB58 && approvers.includes(dynamicB58)) return dynamicPublicKey;
      return null;
    },
    [ledgerPublicKey, dynamicPublicKey],
  );

  const signMessage = useCallback(
    async (
      bytes: Uint8Array,
      preferSigner?: PublicKey | null,
    ): Promise<Uint8Array> => {
      // When the caller has resolved a specific signer pubkey via
      // pickSigner, dispatch to that signer regardless of the
      // ledger-preferred default. Falls back to default when no
      // preference is provided or the preference matches no signer
      // we have available.
      const ledgerMatches =
        preferSigner && ledgerPublicKey
          ? preferSigner.equals(ledgerPublicKey)
          : null;
      const dynamicMatches =
        preferSigner && dynamicPublicKey
          ? preferSigner.equals(dynamicPublicKey)
          : null;

      const useLedger =
        ledgerMatches === true ||
        (ledgerMatches === null && dynamicMatches !== true && !!ledger.session);
      const useDynamic =
        dynamicMatches === true ||
        (dynamicMatches === null && !useLedger);

      if (useLedger && ledger.session) {
        // Ledger expects the offchain-wrapped buffer verbatim. The
        // caller passes exactly that (via `wrapOffchain`); the device
        // recognises the magic prefix and renders the body as text.
        return ledger.session.signOffchainMessage(bytes);
      }
      if (useDynamic) {
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
      }
      throw new Error(
        "No signer available. Connect a Ledger or sign in to a wallet.",
      );
    },
    [solanaWallet, ledger.session, ledgerPublicKey, dynamicPublicKey],
  );

  const disconnect = useCallback(async () => {
    if (ledger.session) {
      await ledger.disconnect();
    }
    await handleLogOut();
  }, [handleLogOut, ledger]);

  /// Sign a v0 transaction through the active signer. Currently only
  /// the Dynamic Solana wallet path is wired (Ledger transaction
  /// signing isn't implemented for clear-msig - every clear-msig flow
  /// signs ed25519 messages, not transactions). The /app/secure
  /// (ikavery vault) flow needs full transaction signing because the
  /// ikavery program is invoked by the user themselves, not via the
  /// shared multisig.
  ///
  /// Throws when called from a Ledger session - caller should detect
  /// `isLedger` and gate accordingly. Throws "no signer" when the
  /// Dynamic Solana wallet isn't ready (e.g. user logged in with email
  /// but the embedded Solana wallet hasn't minted yet).
  const signTransaction = useCallback(
    async <T extends import("@solana/web3.js").Transaction | import("@solana/web3.js").VersionedTransaction>(
      transaction: T,
    ): Promise<T> => {
      if (ledger.session) {
        throw new Error(
          "Ledger transaction signing isn't supported yet. Disconnect Ledger and use your Dynamic wallet.",
        );
      }
      if (!solanaWallet) {
        throw new Error("Connect a wallet before signing");
      }
      // Dynamic's SolanaWallet exposes getSigner() which returns an
      // object implementing ISolana with signTransaction<T>. Same call
      // path the SolanaWalletConnector uses internally.
      const getter = (
        solanaWallet as unknown as {
          getSigner: () => Promise<{
            signTransaction: <U extends import("@solana/web3.js").Transaction | import("@solana/web3.js").VersionedTransaction>(
              tx: U,
            ) => Promise<U>;
          }>;
        }
      ).getSigner;
      if (typeof getter !== "function") {
        throw new Error(
          "This Solana wallet connector does not expose getSigner()",
        );
      }
      const signer = await getter.call(solanaWallet);
      return signer.signTransaction(transaction);
    },
    [solanaWallet, ledger.session],
  );

  return {
    publicKey,
    connected,
    signMessage: connected ? signMessage : undefined,
    /// v0 transaction signing - currently Dynamic-only. Used by the
    /// /app/secure (ikavery vault) create flow which sends ix bundles
    /// directly from the user. Returns the same transaction with
    /// the user's signature added. Throws on Ledger sessions.
    signTransaction: connected ? signTransaction : undefined,
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
    /// Discriminator for whether the connected signer can use the
    /// wrapped offchain path. `null` means the signer works.
    signerIssue,
    /// True when the active Solana wallet is Phantom. Used to route
    /// the plain-body v2 signing path without marking the wallet as
    /// broken in the UI.
    isPhantomWallet,
    /// True when the browser is on a mobile device. On mobile, the
    /// Phantom / Solflare in-app browsers render signMessage payloads
    /// as raw hex instead of decoded text (same bytes as desktop,
    /// different wallet UI). Surface a stronger "verify the preview
    /// above" disclaimer so users aren't asked to trust the hex blob
    /// itself.
    isMobile,
    /// The user's Dynamic embedded-wallet pubkey when one is minted,
    /// independent of which signer is active. Used by `pickSigner` to
    /// select the right pubkey when the on-chain approver list
    /// dictates one over the other (e.g. wallet was created with
    /// embedded pubkey but user later connected a Ledger).
    dynamicPublicKey,
    /// The connected Ledger's pubkey, independent of which signer
    /// is active. Same role as `dynamicPublicKey`.
    ledgerPublicKey,
    /// Resolve the right signer pubkey for a wallet with the given
    /// approver list. Returns null when neither pubkey we hold is in
    /// `approvers` - caller should surface a clear error instead of
    /// letting the on-chain ed25519 verify fail. Pass the chosen
    /// pubkey into signMessage / signDescriptor as `preferSigner` to
    /// route the sign through the matching signer.
    pickSigner,
  };
}

// Single shared Solana connection. Wallet-adapter's ConnectionProvider
// would have given each component an instance via context; we cache one
// at module scope since the RPC URL is static. Memoise per-component to
// keep the same referential identity react-query expects.
//
// Lazy-init: createSolanaConnection() reads localStorage and wires up
// websocket plumbing. Doing that at module evaluation means every
// client component that imports `@/lib/wallet` (most of the app)
// pays the cost on first JS load - including public surfaces like
// /privacy that never hit RPC. The getter defers it until something
// actually calls useConnection() or imports the binding.
let connectionInstance: ReturnType<typeof createSolanaConnection> | null =
  null;
function getSharedConnection() {
  if (connectionInstance === null) {
    connectionInstance = createSolanaConnection("confirmed");
  }
  return connectionInstance;
}

/// Drop-in replacement for `useConnection()` from
/// @solana/wallet-adapter-react. Returns the same `{connection}` shape.
export function useConnection() {
  return useMemo(() => ({ connection: getSharedConnection() }), []);
}
