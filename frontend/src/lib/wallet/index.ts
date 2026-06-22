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
import {
  Connection,
  PublicKey,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import { useDynamicContext, useUserWallets } from "@dynamic-labs/sdk-react-core";
import { isSolanaWallet } from "@dynamic-labs/solana-core";
import { createSolanaConnection } from "@/lib/solana/cluster";
import { useLedger } from "@/lib/wallet/LedgerProvider";
import {
  isCompatibleEmbeddedWallet,
  selectSolanaWallet,
  walletConnectorId,
} from "@/lib/wallet/selection";

type SolanaTransaction = Transaction | VersionedTransaction;

type InjectedSolanaProvider = {
  isBackpack?: boolean;
  isPhantom?: boolean;
  isSolflare?: boolean;
  publicKey?: { toString(): string };
  signTransaction?: <T extends SolanaTransaction>(tx: T) => Promise<T>;
};

type InjectedProviderCandidate = {
  source: "backpack" | "phantom" | "solana" | "solflare";
  provider: InjectedSolanaProvider | undefined;
};

function getInjectedProviderCandidates(
  connectorKey: string,
): InjectedProviderCandidate[] {
  if (typeof window === "undefined") return [];
  const w = window as unknown as {
    backpack?: InjectedSolanaProvider;
    phantom?: { solana?: InjectedSolanaProvider };
    solana?: InjectedSolanaProvider;
    solflare?: InjectedSolanaProvider;
  };
  const wantsSolflare = /solflare/.test(connectorKey);
  const wantsPhantom = /phantom/.test(connectorKey);
  const wantsBackpack = /backpack/.test(connectorKey);
  if (wantsSolflare) {
    return [
      { source: "solflare", provider: w.solflare },
      { source: "solana", provider: w.solana },
    ];
  }
  if (wantsPhantom) {
    return [
      { source: "phantom", provider: w.phantom?.solana },
      { source: "solana", provider: w.solana },
    ];
  }
  if (wantsBackpack) {
    return [
      { source: "backpack", provider: w.backpack },
      { source: "solana", provider: w.solana },
    ];
  }
  return [
    { source: "solana", provider: w.solana },
    { source: "solflare", provider: w.solflare },
    { source: "phantom", provider: w.phantom?.solana },
    { source: "backpack", provider: w.backpack },
  ];
}

function injectedProviderMatchesConnector(
  candidate: InjectedProviderCandidate,
  connectorKey: string,
) {
  const { provider, source } = candidate;
  if (!provider) return false;
  if (/solflare/.test(connectorKey)) {
    return source === "solflare" || provider.isSolflare === true;
  }
  if (/phantom/.test(connectorKey)) {
    return source === "phantom" || provider.isPhantom === true;
  }
  if (/backpack/.test(connectorKey)) {
    return source === "backpack" || provider.isBackpack === true;
  }
  return true;
}

async function signTransactionWithInjectedProvider<T extends SolanaTransaction>({
  connectorKey,
  expectedPublicKey,
  transaction,
}: {
  connectorKey: string;
  expectedPublicKey: PublicKey | null;
  transaction: T;
}): Promise<T | null> {
  const expected = expectedPublicKey?.toBase58();
  if (!expected) return null;

  for (const candidate of getInjectedProviderCandidates(connectorKey)) {
    const { provider } = candidate;
    if (
      !provider ||
      typeof provider.signTransaction !== "function" ||
      !injectedProviderMatchesConnector(candidate, connectorKey)
    ) {
      continue;
    }
    const providerPublicKey = provider.publicKey?.toString();
    if (!providerPublicKey || providerPublicKey !== expected) continue;
    return provider.signTransaction(transaction);
  }
  return null;
}

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
  const dynamicContext = useDynamicContext();
  const { primaryWallet, handleLogOut, sdkHasLoaded } = dynamicContext;
  const setPrimaryWallet = (
    dynamicContext as unknown as {
      setPrimaryWallet?: (walletId: string) => Promise<void>;
    }
  ).setPrimaryWallet;
  const allWallets = useUserWallets();
  const ledger = useLedger();

  // Prefer the active wallet when it's Solana; otherwise grab any
  // Solana wallet the user has minted (e.g. they logged in via email,
  // primary is EVM, but a Solana embedded wallet was also minted).
  const solanaWallet = useMemo(() => {
    return selectSolanaWallet(primaryWallet, allWallets, isSolanaWallet);
  }, [primaryWallet, allWallets]);

  const dynamicPublicKey = useMemo(() => {
    if (!solanaWallet?.address) return null;
    try {
      return new PublicKey(solanaWallet.address);
    } catch {
      return null;
    }
  }, [solanaWallet]);

  // Historical note: older Dynamic WaaS Solana signers corrupted the
  // wrapped offchain envelope's leading 0xff byte. The app now defaults
  // software wallets to plain_v2 (ASCII body bytes) and locally verifies
  // every returned signature before submit, so connector-name blocking is
  // no longer correct. If any signer still mutates bytes, signBytes throws
  // `wallet_signed_wrong_bytes` with a targeted recovery message.
  const signerIssue = useMemo<"waas" | null>(() => {
    if (ledger.session) return null; // Ledger always wins.
    return null;
  }, [ledger.session]);

  const walletConnectorKey = useMemo(() => walletConnectorId(solanaWallet), [solanaWallet]);
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
        // Phantom mobile in-app browser: bypass the Dynamic SDK and
        // call window.solana.signMessage(bytes, "utf8") directly so
        // Phantom renders the body as text instead of raw hex. Going
        // through Dynamic's signer drops the display hint (the Solana
        // wallet-adapter signature is `signMessage(bytes)`, no second
        // arg), so the same bytes that render fine on the extension
        // come up as a hex blob on mobile. Phantom's own API does
        // accept the display hint, so we route around the adapter
        // when Phantom is injected at window.solana.
        //
        // Gated tightly: only when (a) we detect mobile, (b) Dynamic
        // says the active connector is Phantom, (c) window.solana
        // exists and reports isPhantom, and (d) Phantom's published
        // pubkey matches the Dynamic-tracked one. If any check fails
        // we fall through to the standard adapter path. Errors from
        // Phantom itself (rejected, locked, etc.) propagate verbatim
        // — falling back would mean a second popup.
        if (isMobile && isPhantomWallet && typeof window !== "undefined") {
          const phantom = (
            window as unknown as {
              solana?: {
                isPhantom?: boolean;
                publicKey?: { toString(): string };
                signMessage?: (
                  b: Uint8Array,
                  display?: string,
                ) => Promise<unknown>;
              };
            }
          ).solana;
          const phantomPk = phantom?.publicKey?.toString();
          const dynamicPk = dynamicPublicKey?.toBase58();
          if (
            phantom?.isPhantom &&
            typeof phantom.signMessage === "function" &&
            phantomPk &&
            dynamicPk &&
            phantomPk === dynamicPk
          ) {
            const result = await phantom.signMessage(bytes, "utf8");
            if (result instanceof Uint8Array) return result;
            const sig = (result as { signature?: Uint8Array })?.signature;
            if (!(sig instanceof Uint8Array)) {
              throw new Error(
                "Phantom returned an unexpected signMessage shape",
              );
            }
            return sig;
          }
        }
        const signer = await (
          solanaWallet as unknown as {
            getSigner: () => Promise<{
              signMessage: (
                b: Uint8Array,
              ) => Promise<Uint8Array | { signature?: Uint8Array }>;
            }>;
          }
        ).getSigner();
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
    [solanaWallet, ledger.session, ledgerPublicKey, dynamicPublicKey, isMobile, isPhantomWallet],
  );

  const disconnect = useCallback(async () => {
    if (ledger.session) {
      await ledger.disconnect();
    }
    await handleLogOut();
  }, [handleLogOut, ledger]);

  /// Sign a v0 transaction through the active signer. Ledger transaction
  /// signing isn't implemented for clear-msig - every clear-msig flow
  /// signs ed25519 messages, not transactions. The /app/secure
  /// (ikavery vault) flow needs full transaction signing because the
  /// ikavery program is invoked by the user themselves, not via the
  /// shared multisig. External injected wallets are called directly
  /// when their browser provider matches Dynamic's tracked pubkey; this
  /// avoids accidentally routing Solflare / Phantom / Backpack through
  /// an embedded WebAuthn wallet path.
  ///
  /// Throws when called from a Ledger session - caller should detect
  /// `isLedger` and gate accordingly. Throws "no signer" when the
  /// Dynamic Solana wallet isn't ready (e.g. user logged in with email
  /// but the embedded Solana wallet hasn't minted yet).
  const signTransaction = useCallback(
    async <T extends SolanaTransaction>(
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
      const solanaWalletId = (solanaWallet as { id?: string })?.id;
      const primaryWalletId = (primaryWallet as { id?: string } | null)?.id;
      if (
        solanaWalletId &&
        primaryWalletId !== solanaWalletId &&
        typeof setPrimaryWallet === "function"
      ) {
        await setPrimaryWallet(solanaWalletId);
      }
      if (!isCompatibleEmbeddedWallet(solanaWallet)) {
        const injectedSigned = await signTransactionWithInjectedProvider({
          connectorKey: walletConnectorKey,
          expectedPublicKey: dynamicPublicKey,
          transaction,
        });
        if (injectedSigned) return injectedSigned;
      }
      // Dynamic's embedded Solana connector wraps `signTransaction` in a
      // UI simulation modal. When the user signed in with Google, Dynamic can
      // keep the embedded EVM wallet as primary and that modal renders as
      // "Ethereum Mainnet" even for a Solana transaction. For Secure, bypass
      // only that UI wrapper and call Turnkey's Solana transaction signer
      // directly. External wallets still use their injected Solana popup.
      if (isCompatibleEmbeddedWallet(solanaWallet)) {
        const connector = (
          solanaWallet as unknown as {
            connector?: {
              validateActiveWallet?: (expectedAddress: string) => Promise<void>;
              internalSignTransaction?: <U extends SolanaTransaction>(
                tx: U,
              ) => Promise<U>;
            };
          }
        ).connector;
        const expected = dynamicPublicKey?.toBase58();
        if (
          expected &&
          connector &&
          typeof connector.internalSignTransaction === "function"
        ) {
          if (typeof connector.validateActiveWallet === "function") {
            await connector.validateActiveWallet(expected);
          }
          return connector.internalSignTransaction(transaction);
        }
        throw new Error(
          "Embedded Solana transaction signing is unavailable. Reconnect your Google account, then try again. ClearSig will not open Dynamic's generic transaction modal for Secure actions.",
        );
      }

      // Dynamic's SolanaWallet exposes getSigner() which returns an object
      // implementing ISolana with signTransaction<T>. This is the fallback for
      // embedded connector versions that do not expose internalSignTransaction.
      const getter = (
        solanaWallet as unknown as {
          getSigner: () => Promise<{
            signTransaction: <U extends SolanaTransaction>(
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
    [
      solanaWallet,
      ledger.session,
      walletConnectorKey,
      dynamicPublicKey,
      primaryWallet,
      setPrimaryWallet,
    ],
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
