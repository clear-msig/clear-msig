import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const typedProposalCreators = [
  "src/lib/hooks/usePersistWalletPolicy.ts",
  "src/lib/hooks/completeTypedGovernance.ts",
  "src/lib/hooks/useBatchSend.ts",
  "src/features/send/routes/EthSendPage.tsx",
  "src/features/send/routes/ZecSendPage.tsx",
  "src/features/send/routes/Erc20SendPage.tsx",
  "src/features/send/routes/BtcSendPage.tsx",
  "src/features/send/routes/SolanaSendPage.tsx",
  "src/features/treasury/routes/EscrowPage.tsx",
  "src/lib/agents/useAgentTypedSessionGrant.ts",
  "src/lib/agents/useAgentTypedRiskPolicy.ts",
  "src/lib/agents/useAgentTypedClearSignApproval.ts",
  "src/lib/agents/useAgentTypedTradeSettlement.ts",
] as const;

describe("typed proposal signing contract", () => {
  it.each(typedProposalCreators)(
    "binds the wallet signature to browser-reviewed details in %s",
    (path) => {
      const file = readFileSync(resolve(process.cwd(), path), "utf8");
      expect(file).toContain("prepare.createTypedProposal");
      expect(file).toContain("expectedTyped:");
      expect(file).toContain("signableText:");
      expect(file).toContain("payloadHash:");
      expect(file).toContain("envelopeHash:");
    },
  );
});
