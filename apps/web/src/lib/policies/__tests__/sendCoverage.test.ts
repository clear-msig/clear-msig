import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sendPages = [
  "src/features/send/routes/SolanaSendPage.tsx",
  "src/features/send/routes/BtcSendPage.tsx",
  "src/features/send/routes/EthSendPage.tsx",
  "src/features/send/routes/Erc20SendPage.tsx",
  "src/features/send/routes/ZecSendPage.tsx",
] as const;

describe("send policy enforcement coverage", () => {
  it("hard-stops deny policies inside each send mutation, not only in the UI button state", () => {
    for (const page of sendPages) {
      const source = readFileSync(resolve(process.cwd(), page), "utf8");
      expect(source, page).toContain("assertPolicyNotDenied");
    }
  });
});
