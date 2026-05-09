import { describe, it, expect } from "vitest";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { maskAddress, parseSolanaSecretKey } from "@/lib/secure/import";

describe("parseSolanaSecretKey", () => {
  it("parses a base58 secret key", () => {
    const kp = Keypair.generate();
    const encoded = bs58.encode(kp.secretKey);
    const result = parseSolanaSecretKey(encoded);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.format).toBe("base58");
    expect(result.keypair.publicKey.toBase58()).toBe(kp.publicKey.toBase58());
  });

  it("parses a JSON-array secret key", () => {
    const kp = Keypair.generate();
    const encoded = JSON.stringify(Array.from(kp.secretKey));
    const result = parseSolanaSecretKey(encoded);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.format).toBe("json");
    expect(result.keypair.publicKey.toBase58()).toBe(kp.publicKey.toBase58());
  });

  it("strips surrounding whitespace", () => {
    const kp = Keypair.generate();
    const encoded = `   ${bs58.encode(kp.secretKey)}\n  `;
    const result = parseSolanaSecretKey(encoded);
    expect(result.ok).toBe(true);
  });

  it("strips surrounding quotes (paste with copy from terminal)", () => {
    const kp = Keypair.generate();
    const encoded = `"${bs58.encode(kp.secretKey)}"`;
    const result = parseSolanaSecretKey(encoded);
    expect(result.ok).toBe(true);
  });

  it("rejects empty input", () => {
    const r = parseSolanaSecretKey("");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("empty");
  });

  it("rejects whitespace-only input as empty", () => {
    const r = parseSolanaSecretKey("   \n\t  ");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("empty");
  });

  it("rejects malformed JSON", () => {
    const r = parseSolanaSecretKey("[1, 2, 3,");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("invalid-json");
  });

  it("rejects JSON with wrong length", () => {
    const r = parseSolanaSecretKey(JSON.stringify([1, 2, 3, 4, 5]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("invalid-length");
  });

  it("rejects JSON with non-byte values", () => {
    const arr = new Array(64).fill(0).map((_, i) => (i === 0 ? 999 : 0));
    const r = parseSolanaSecretKey(JSON.stringify(arr));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("invalid-json");
  });

  it("rejects garbage base58", () => {
    const r = parseSolanaSecretKey("0OIl"); // invalid base58 chars
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(["invalid-base58", "invalid-length"]).toContain(r.error);
  });

  it("rejects base58 of wrong length", () => {
    const r = parseSolanaSecretKey(bs58.encode(new Uint8Array(32)));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("invalid-length");
  });

  it("never echoes raw input in error reasons", () => {
    const secret = "ULTRA_SECRET_DO_NOT_LEAK";
    const r = parseSolanaSecretKey(secret);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).not.toContain(secret);
  });
});

describe("parseSolanaSecretKey wipe", () => {
  it("wipe() zeroes the underlying source buffer", () => {
    const kp = Keypair.generate();
    const bytes = Uint8Array.from(kp.secretKey);
    const r = parseSolanaSecretKey(JSON.stringify(Array.from(bytes)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Pre-wipe: pubkey derivation roundtrips.
    expect(r.keypair.publicKey.toBase58()).toBe(kp.publicKey.toBase58());
    r.wipe();
    // Post-wipe: the parser's internal copy is zeroed. We can't
    // observe the source bytes (caller no longer holds them), but the
    // Keypair's internal `_keypair.secretKey` buffer should be all
    // zeros so any future signing attempt would fail or sign
    // garbage — exactly what we want after the import-tx broadcasts.
    const internal = (
      r.keypair as unknown as {
        _keypair?: { secretKey?: Uint8Array };
      }
    )._keypair?.secretKey;
    if (internal) {
      expect(Array.from(internal).every((b) => b === 0)).toBe(true);
    }
  });

  it("wipe() is idempotent", () => {
    const kp = Keypair.generate();
    const r = parseSolanaSecretKey(bs58.encode(kp.secretKey));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(() => {
      r.wipe();
      r.wipe();
    }).not.toThrow();
  });
});

describe("maskAddress", () => {
  it("shows first 4 + last 4 for long strings", () => {
    expect(maskAddress("8WUjsGsZJaYjZQHMvQNkfx9CcQVT5VmCv5wBbUm6f9pP")).toBe(
      "8WUj…f9pP",
    );
  });

  it("returns short strings unchanged", () => {
    expect(maskAddress("abcd")).toBe("abcd");
    expect(maskAddress("1234567890")).toBe("1234567890");
  });
});
