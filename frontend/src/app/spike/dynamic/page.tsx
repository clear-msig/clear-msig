"use client";

// Dynamic spike — does the embedded-wallet signMessage produce an
// ed25519 signature the on-chain Clear program will accept?
//
// This is a one-page proof. It does NOT touch the rest of the app's
// wallet-adapter wiring; it stands alone at /spike/dynamic with its
// own DynamicContextProvider. Test flow:
//
//   1. Set NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID (from app.dynamic.xyz).
//   2. Visit /spike/dynamic, log in via email or external Solana wallet.
//   3. Click "Sign test message".
//   4. The page verifies the signature client-side with tweetnacl
//      (same ed25519 algorithm the Clear program uses on chain via
//      brine_ed25519::sig_verify).
//
// If verification passes, the full migration is unblocked:
// embedded-wallet sigs are wire-compatible with the existing
// PreSignedMessageSigner + program verifier.

import { useMemo, useState } from "react";
import nacl from "tweetnacl";
import {
  DynamicContextProvider,
  DynamicWidget,
  useDynamicContext,
} from "@dynamic-labs/sdk-react-core";
import { isSolanaWallet } from "@dynamic-labs/solana-core";
// Embedded-wallet-solana is the Turnkey-backed connector that mints
// a Solana wallet for users who log in with email / passkey / social.
// External Solana wallets (Phantom / Solflare / Backpack) come in
// through Dynamic's wallet-standard auto-discovery without an extra
// connector import.
import { TurnkeySolanaWalletConnectors } from "@dynamic-labs/embedded-wallet-solana";
import { toHex } from "@/lib/msig";

const TEST_MESSAGE = new TextEncoder().encode(
  "Clear spike: does Dynamic's embedded-wallet signMessage produce an ed25519 sig the Clear program accepts?",
);

export default function DynamicSpikePage() {
  const environmentId = process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID;

  if (!environmentId) {
    return (
      <main className="min-h-screen bg-canvas px-gutter py-12">
        <div className="mx-auto max-w-xl rounded-card border border-warning/30 bg-warning/5 p-6">
          <h1 className="font-display text-display-xs text-text-strong">
            Dynamic env ID not set
          </h1>
          <p className="mt-2 text-sm text-text-soft">
            This spike page reads{" "}
            <code className="rounded bg-canvas px-1 py-0.5 font-mono text-xs">
              NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID
            </code>{" "}
            from env. Get one from{" "}
            <a
              href="https://app.dynamic.xyz"
              className="text-accent underline"
              target="_blank"
              rel="noreferrer"
            >
              app.dynamic.xyz
            </a>
            , add it to{" "}
            <code className="rounded bg-canvas px-1 py-0.5 font-mono text-xs">
              .env.local
            </code>
            , and restart the dev server.
          </p>
          <pre className="mt-4 overflow-x-auto rounded bg-canvas p-3 text-xs text-text-strong">
            NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID=&lt;your-id&gt;
          </pre>
        </div>
      </main>
    );
  }

  return (
    <DynamicContextProvider
      settings={{
        environmentId,
        walletConnectors: [TurnkeySolanaWalletConnectors],
      }}
    >
      <SpikeBody />
    </DynamicContextProvider>
  );
}

interface SignResult {
  pubkey: string;
  signatureHex: string;
  verified: boolean;
  message: string;
}

function SpikeBody() {
  const { primaryWallet } = useDynamicContext();
  const [result, setResult] = useState<SignResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);

  const isSolana = useMemo(
    () => (primaryWallet ? isSolanaWallet(primaryWallet) : false),
    [primaryWallet],
  );

  const handleSign = async () => {
    if (!primaryWallet || !isSolanaWallet(primaryWallet)) {
      setError("Connect a Solana wallet first.");
      return;
    }
    setSigning(true);
    setError(null);
    setResult(null);
    try {
      const signer = await primaryWallet.getSigner();
      const signed = await signer.signMessage(TEST_MESSAGE);
      // Dynamic returns either Uint8Array directly or {signature: ...}
      // depending on version — normalize.
      const sigBytes: Uint8Array =
        signed instanceof Uint8Array
          ? signed
          : (signed as { signature: Uint8Array }).signature;
      const pubkey = primaryWallet.address;

      // Verify against tweetnacl, the same ed25519 algorithm the
      // Clear program uses on chain via brine_ed25519. If this
      // passes, the on-chain verifier will too.
      const pubkeyBytes = base58Decode(pubkey);
      const verified = nacl.sign.detached.verify(
        TEST_MESSAGE,
        sigBytes,
        pubkeyBytes,
      );

      setResult({
        pubkey,
        signatureHex: toHex(sigBytes),
        verified,
        message: new TextDecoder().decode(TEST_MESSAGE),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSigning(false);
    }
  };

  return (
    <main className="min-h-screen bg-canvas px-gutter py-12">
      <div className="mx-auto max-w-2xl">
        <header className="mb-8">
          <span className="inline-flex items-center rounded-full border border-warning/30 bg-warning/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-warning">
            Spike — not user-facing
          </span>
          <h1 className="mt-3 font-display text-display-md text-text-strong">
            Dynamic ↔ Clear sig compatibility
          </h1>
          <p className="mt-2 text-sm text-text-soft">
            Verifies that{" "}
            <code className="font-mono text-xs">primaryWallet.getSigner().signMessage()</code>{" "}
            on a Dynamic embedded wallet produces an ed25519 signature
            that <code className="font-mono text-xs">tweetnacl.sign.detached.verify</code>{" "}
            (and therefore the on-chain Clear program) accepts.
          </p>
        </header>

        <section className="rounded-card border border-border-soft bg-surface-raised p-6 shadow-card-rest">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
            Step 1 · Connect
          </p>
          <p className="mt-1 text-sm text-text-soft">
            Email login mints an embedded Solana wallet on the fly. External
            wallets (Phantom / Solflare / Backpack) work too — both paths
            should produce the same compatible sig.
          </p>
          <div className="mt-4">
            <DynamicWidget />
          </div>
          {primaryWallet && (
            <p className="mt-3 text-xs text-text-soft">
              Connected as{" "}
              <code className="font-mono text-text-strong">
                {primaryWallet.address?.slice(0, 4)}…
                {primaryWallet.address?.slice(-4)}
              </code>{" "}
              · {isSolana ? "Solana wallet ✓" : "NOT a Solana wallet ✗"}
            </p>
          )}
        </section>

        <section className="mt-4 rounded-card border border-border-soft bg-surface-raised p-6 shadow-card-rest">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
            Step 2 · Sign + verify
          </p>
          <p className="mt-1 text-sm text-text-soft">
            Test message:{" "}
            <code className="font-mono text-xs text-text-strong">
              {new TextDecoder().decode(TEST_MESSAGE)}
            </code>
          </p>
          <button
            type="button"
            onClick={handleSign}
            disabled={!primaryWallet || !isSolana || signing}
            className={
              "mt-4 inline-flex items-center justify-center rounded-soft bg-accent px-4 py-2 text-sm font-medium text-white shadow-accent-rest " +
              "transition-[background-color,transform] duration-base ease-out-soft " +
              "hover:bg-accent-hover active:scale-[0.98] " +
              "disabled:cursor-not-allowed disabled:opacity-50"
            }
          >
            {signing ? "Signing…" : "Sign test message"}
          </button>

          {error && (
            <pre className="mt-4 overflow-x-auto rounded-soft border border-danger/30 bg-danger/5 p-3 text-xs text-danger">
              {error}
            </pre>
          )}

          {result && (
            <div className="mt-4 space-y-3">
              <div
                className={
                  "rounded-card border p-4 " +
                  (result.verified
                    ? "border-accent/30 bg-accent/5"
                    : "border-danger/30 bg-danger/5")
                }
              >
                <p
                  className={
                    "text-sm font-semibold " +
                    (result.verified ? "text-accent" : "text-danger")
                  }
                >
                  {result.verified
                    ? "✓ Signature verifies as ed25519 — migration unblocked."
                    : "✗ Signature did NOT verify — Dynamic's signer is incompatible. Dig deeper before migrating."}
                </p>
              </div>
              <SpikeKv label="Pubkey" value={result.pubkey} mono />
              <SpikeKv label="Signature (hex)" value={result.signatureHex} mono wrap />
              <SpikeKv label="Message" value={result.message} />
            </div>
          )}
        </section>

        <footer className="mt-6 text-xs text-text-soft">
          What this proves: signMessage returns a 64-byte ed25519 sig
          over the exact bytes we passed in, signed by the wallet&rsquo;s
          public key. The on-chain program calls{" "}
          <code className="font-mono text-text-strong">brine_ed25519::sig_verify</code>{" "}
          with the same three inputs — algorithm parity means a sig that
          passes here passes there.
        </footer>
      </div>
    </main>
  );
}

function SpikeKv({
  label,
  value,
  mono,
  wrap,
}: {
  label: string;
  value: string;
  mono?: boolean;
  wrap?: boolean;
}) {
  return (
    <div className="rounded-soft border border-border-soft bg-canvas p-3">
      <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-soft">
        {label}
      </p>
      <p
        className={
          "mt-1 text-text-strong " +
          (mono ? "font-mono text-xs " : "text-sm ") +
          (wrap ? "break-all" : "truncate")
        }
      >
        {value}
      </p>
    </div>
  );
}

// Solana base58 → bytes. Dynamic ships bs58 transitively via
// @dynamic-labs/solana → @dynamic-labs/solana/node_modules/bs58, but
// importing it through Dynamic is fragile. Fall back to a tiny inline
// decoder so the spike page has zero extra direct deps.
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Decode(s: string): Uint8Array {
  const map = new Map<string, number>();
  for (let i = 0; i < BASE58.length; i++) map.set(BASE58[i], i);
  let bytes = [0];
  for (const c of s) {
    const v = map.get(c);
    if (v === undefined) throw new Error(`invalid base58 char: ${c}`);
    let carry = v;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Leading zeros (each leading '1' in base58 is one zero byte).
  for (let k = 0; k < s.length && s[k] === "1"; k++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}
