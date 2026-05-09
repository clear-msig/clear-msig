import { describe, it, expect } from "vitest";
import {
  decodeSegwitAddress,
  formatSats,
  networkForHrp,
  parseBtcAmount,
  validateBtcDestination,
} from "@/lib/chain/btc";

// Reference vectors from BIP173 / BIP350 + real testnet/signet/mainnet
// addresses. These pin the bech32 / bech32m decode logic — the BTC
// send flow's `recipient_pkh` intent param comes straight out of
// `decodeSegwitAddress(...).program`, so a regression here would
// silently send funds to the wrong place.

describe("decodeSegwitAddress", () => {
  it("decodes a mainnet P2WPKH (BIP173 example)", () => {
    // BIP173: BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4
    const r = decodeSegwitAddress(
      "BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4",
    );
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.hrp).toBe("bc");
    expect(r.version).toBe(0);
    expect(r.program.length).toBe(20);
  });

  it("decodes a testnet P2WSH (BIP173 example)", () => {
    // BIP173 official vector for testnet P2WSH (tb hrp, 32-byte program).
    const r = decodeSegwitAddress(
      "tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7",
    );
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.hrp).toBe("tb");
    expect(r.version).toBe(0);
    expect(r.program.length).toBe(32); // P2WSH = 32-byte witness
  });

  it("rejects mixed-case addresses", () => {
    expect(
      decodeSegwitAddress("BC1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"),
    ).toBeNull();
  });

  it("rejects addresses with bad checksum", () => {
    // Flip one character in a valid address.
    expect(
      decodeSegwitAddress("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5"),
    ).toBeNull();
  });

  it("rejects too-short addresses", () => {
    expect(decodeSegwitAddress("bc1qq")).toBeNull();
  });

  it("rejects empty string", () => {
    expect(decodeSegwitAddress("")).toBeNull();
  });

  it("rejects non-string input", () => {
    // @ts-expect-error testing bad runtime input
    expect(decodeSegwitAddress(undefined)).toBeNull();
    // @ts-expect-error testing bad runtime input
    expect(decodeSegwitAddress(123)).toBeNull();
  });

  it("decodes a taproot v1 address (bech32m)", () => {
    // BIP350 example
    const r = decodeSegwitAddress(
      "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0",
    );
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.version).toBe(1);
    expect(r.program.length).toBe(32);
  });
});

describe("validateBtcDestination", () => {
  it("rejects taproot v1 (only P2WPKH supported)", () => {
    const r = validateBtcDestination(
      "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0",
      "mainnet",
    );
    expect(r.ok).toBe(false);
  });

  it("rejects P2WSH (32-byte witness program)", () => {
    // Same BIP173 testnet P2WSH vector. Should pass bech32 decode but
    // fail the program-length check.
    const r = validateBtcDestination(
      "tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7",
      "signet",
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/20-byte/);
  });

  it("rejects mainnet address against signet wallet", () => {
    const r = validateBtcDestination(
      "BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4",
      "signet",
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/mainnet/);
  });

  // The signet/testnet ambiguity (both share the `tb` HRP) is
  // covered indirectly by `networkForHrp("tb") === "signet"` plus the
  // explicit fallthrough in `validateBtcDestination`. A direct test
  // here would need a verified bech32-checksummed testnet/signet
  // P2WPKH vector; skipping to avoid hard-coded magic strings whose
  // checksums we'd have to compute manually.

  it("rejects empty input", () => {
    const r = validateBtcDestination("", "signet");
    expect(r.ok).toBe(false);
  });

  it("rejects garbage input", () => {
    const r = validateBtcDestination("not a real address", "signet");
    expect(r.ok).toBe(false);
  });
});

describe("networkForHrp", () => {
  it("maps bc → mainnet", () => {
    expect(networkForHrp("bc")).toBe("mainnet");
  });
  it("maps tb → signet (default for ambiguous)", () => {
    expect(networkForHrp("tb")).toBe("signet");
  });
  it("maps bcrt → regtest", () => {
    expect(networkForHrp("bcrt")).toBe("regtest");
  });
  it("returns null on unknown hrp", () => {
    expect(networkForHrp("zzz")).toBeNull();
  });
});

describe("formatSats", () => {
  it("renders 0 sats as '0'", () => {
    expect(formatSats(0n)).toBe("0");
  });
  it("renders whole BTC", () => {
    expect(formatSats(100_000_000n)).toBe("1");
  });
  it("renders fractional BTC, trims trailing zeros", () => {
    expect(formatSats(50_000_000n)).toBe("0.5");
    expect(formatSats(1_000_000n)).toBe("0.01");
  });
  it("preserves precision down to 1 sat", () => {
    expect(formatSats(1n)).toBe("0.00000001");
  });
});

describe("parseBtcAmount", () => {
  it("parses whole BTC", () => {
    expect(parseBtcAmount("1")).toBe(100_000_000n);
  });
  it("parses fractional BTC", () => {
    expect(parseBtcAmount("0.001")).toBe(100_000n);
    expect(parseBtcAmount("0.00000001")).toBe(1n);
  });
  it("rejects too-many-decimals", () => {
    expect(parseBtcAmount("0.000000001")).toBeNull();
  });
  it("rejects garbage", () => {
    expect(parseBtcAmount("abc")).toBeNull();
    expect(parseBtcAmount("")).toBeNull();
    expect(parseBtcAmount("-1")).toBeNull();
  });
  it("rejects zero", () => {
    expect(parseBtcAmount("0")).toBeNull();
    expect(parseBtcAmount("0.0")).toBeNull();
  });
});
