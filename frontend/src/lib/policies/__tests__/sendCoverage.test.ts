import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sendPages = [
  "src/app/app/wallet/[name]/send/page.tsx",
  "src/app/app/wallet/[name]/send/btc/page.tsx",
  "src/app/app/wallet/[name]/send/eth/page.tsx",
  "src/app/app/wallet/[name]/send/erc20/page.tsx",
  "src/app/app/wallet/[name]/send/zec/page.tsx",
] as const;

describe("send policy enforcement coverage", () => {
  it("hard-stops deny policies inside each send mutation, not only in the UI button state", () => {
    for (const page of sendPages) {
      const source = readFileSync(resolve(process.cwd(), page), "utf8");
      expect(source, page).toContain("assertPolicyNotDenied");
    }
  });
});
