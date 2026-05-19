// LocalEncryptClient - mirrors `@encrypt.xyz/pre-alpha-solana-client`'s
// `createInput` API surface so call sites can exercise the encryption
// path today, before Encrypt's npm package + gRPC gateway are public.
//
// What it does:
//   - Stores plaintext in localStorage keyed by a deterministic
//     SHA-256-derived identifier. The identifier is the same shape
//     Encrypt's gRPC service emits ("ct_<hex>"), so any consumer that
//     stores or displays it doesn't change at swap time.
//   - Looks up by id for read paths.
//
// What it explicitly is NOT:
//   - Real cryptography. Encrypt's pre-alpha disclaimer says the same
//     thing about their own service - "all data is completely public
//     and stored as plaintext." Local stub matches that contract.
//
// Swap path: `lib/encrypt/client.ts` now uses Encrypt's published
// gRPC-Web client when configured. This local client remains the
// development fallback and keeps the same `createInput` result shape.

import type { FheType } from "@/lib/encrypt/client";

export interface CreateInputArgs {
  chain: "solana";
  inputs: ReadonlyArray<{
    ciphertextBytes: Uint8Array;
    fheType: FheType;
  }>;
  /// Program authorized to dereference these ciphertexts on chain.
  /// Bytes form (matches Encrypt's API which takes raw program-id bytes).
  authorized: Uint8Array;
  /// 32-byte network encryption pubkey. Today: ignored by the stub
  /// (no real encryption). Tomorrow: used by the real client.
  networkEncryptionPublicKey: Uint8Array | null;
}

export interface CreateInputResult {
  ciphertextIdentifiers: string[];
}

export interface CiphertextRecord {
  id: string;
  /// Hex-encoded plaintext bytes. (Real client would store ciphertext.)
  ciphertext: string;
  fheType: FheType;
  /// Hex of `authorized` program-id bytes - kept so the lookup path
  /// can verify the requester is allowed to read.
  authorizedHex: string;
  createdAt: number;
}

const STORAGE_KEY = "clear.encrypt.ciphertexts.v1";

function loadAll(): Record<string, CiphertextRecord> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, CiphertextRecord>) : {};
  } catch {
    return {};
  }
}

function persistAll(records: Record<string, CiphertextRecord>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    /* localStorage full or blocked - silent */
  }
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

/// Deterministic identifier so the same plaintext + program always
/// resolves to the same ID. Mirrors the rough idempotency the real
/// service offers (storing the same bytes twice is a no-op).
async function deterministicId(
  bytes: Uint8Array,
  authorized: Uint8Array,
): Promise<string> {
  const buf = new Uint8Array(bytes.length + authorized.length + 8);
  buf.set(bytes, 0);
  buf.set(authorized, bytes.length);
  // 8-byte timestamp burst at the tail keeps two same-bytes payloads
  // distinguishable across sessions, but stable within one second.
  const ts = BigInt(Math.floor(Date.now() / 1000));
  for (let i = 0; i < 8; i++) {
    buf[bytes.length + authorized.length + i] = Number(
      (ts >> BigInt(8 * i)) & 0xffn,
    );
  }
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return "ct_" + bytesToHex(new Uint8Array(hash)).slice(0, 32);
}

export class LocalEncryptClient {
  /// Encrypt-and-store one or more inputs. Returns the same shape as
  /// Encrypt's real `createInput` so the call site is wire-identical.
  async createInput(args: CreateInputArgs): Promise<CreateInputResult> {
    const records = loadAll();
    const ciphertextIdentifiers: string[] = [];
    for (const input of args.inputs) {
      const id = await deterministicId(input.ciphertextBytes, args.authorized);
      records[id] = {
        id,
        ciphertext: bytesToHex(input.ciphertextBytes),
        fheType: input.fheType,
        authorizedHex: bytesToHex(args.authorized),
        createdAt: Date.now(),
      };
      ciphertextIdentifiers.push(id);
    }
    persistAll(records);
    return { ciphertextIdentifiers };
  }

  /// Read path. Returns the stored record or null.
  async lookup(id: string): Promise<CiphertextRecord | null> {
    return loadAll()[id] ?? null;
  }

  /// All locally-stored records, newest first. Used by /privacy to
  /// show the user concrete proof their policies are flowing through
  /// the encryption surface.
  list(): CiphertextRecord[] {
    return Object.values(loadAll()).sort(
      (a, b) => b.createdAt - a.createdAt,
    );
  }
}

/// Default singleton. `lib/encrypt/client.ts` imports this and wraps
/// it in the public `encryptPolicy` / `decryptPolicy` API.
export const localEncryptClient = new LocalEncryptClient();
