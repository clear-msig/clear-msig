import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const v4TypedProposalCreators = [
  "src/lib/hooks/completeTypedGovernance.ts",
  "src/lib/hooks/useBatchSend.ts",
  "src/features/send/routes/EthSendPage.tsx",
  "src/features/send/routes/ZecSendPage.tsx",
  "src/features/send/routes/Erc20SendPage.tsx",
  "src/features/send/routes/BtcSendPage.tsx",
  "src/features/send/routes/SolanaSendPage.tsx",
  "src/lib/agents/useAgentTypedSessionGrant.ts",
  "src/lib/agents/useAgentTypedRiskPolicy.ts",
  "src/lib/agents/useAgentTypedClearSignApproval.ts",
  "src/lib/agents/useAgentTypedTradeSettlement.ts",
  "src/features/treasury/ui/EscrowProjectCard.tsx",
  "src/lib/hooks/usePersistWalletPolicy.ts",
] as const;

describe("typed proposal signing contract", () => {
  it.each(v4TypedProposalCreators)(
    "binds trusted v4 canonical bytes through proposal submission in %s",
    (path) => {
      const file = readFileSync(resolve(process.cwd(), path), "utf8");
      expect(file).toContain("prepareClearSignV4Action");
      expect(file).toContain("prepare.createTypedProposal");
      expect(file).toContain("expectedTyped:");
      expect(file).toContain("signableText:");
      expect(file).toContain("payloadHash:");
      expect(file).toContain("envelopeHash:");
      expect(file).toMatch(
        /canonical_intent_hex:\s*(summary|prepared)\.canonicalIntentHex/,
      );
      expect(file).toMatch(
        /canonical_intent_hex:\s*(dry|prepared\.dry)\.canonical_intent_hex/,
      );
      expect(file).toMatch(
        /policy_commitment:\s*(summary|prepared)\.policyCommitment/,
      );
    },
  );

});
