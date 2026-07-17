import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  INTENT_SCHEMA_VERSION,
  INTENT_TEMPLATES,
  templateFileForChainKind,
  templateFileForId,
} from "@/lib/intents/generatedRegistry";

describe("versioned intent registry", () => {
  it("matches every Rust-generated built-in intent artifact", () => {
    expect(INTENT_SCHEMA_VERSION).toBe(1);
    expect(new Set(INTENT_TEMPLATES.map((entry) => entry.id)).size).toBe(
      INTENT_TEMPLATES.length,
    );

    for (const registered of INTENT_TEMPLATES) {
      const file = resolve(process.cwd(), "../..", registered.file);
      const intent = JSON.parse(readFileSync(file, "utf8"));
      expect(intent.schema_version).toBe(INTENT_SCHEMA_VERSION);
      expect(intent.template_id).toBe(registered.id);
      expect(intent.chain ?? "solana").toBe(registered.chain);
      expect(intent.template).toBe(registered.template);
      expect(templateFileForId(registered.id)).toBe(registered.file);
    }
  });

  it("provides one canonical editable template for every supported chain", () => {
    expect([0, 1, 2, 3, 4, 5].map(templateFileForChainKind)).toEqual([
      "examples/intents/solana_transfer.json",
      "examples/intents/evm_transfer_sepolia.json",
      "examples/intents/btc_transfer.json",
      "examples/intents/zcash_transfer.json",
      "examples/intents/erc20_transfer_sepolia.json",
      "examples/intents/hyperliquid_transfer.json",
    ]);
    expect(() => templateFileForChainKind(255)).toThrow(/No default/);
  });
});
