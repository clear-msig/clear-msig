const crypto = require("node:crypto");
const { PublicKey } = require("@solana/web3.js");
const pk = (n) => new PublicKey(new Uint8Array(32).fill(n)).toBase58();
const stamp = 1791288000000;
const agent = {
  id: "review-trader",
  walletName: "operations",
  name: "Review trader",
  kind: "manual",
  status: "paused",
  description: "Synthetic profile for app-owned layout review. No execution.",
  createdAt: stamp,
  updatedAt: stamp,
  version: 1,
  strategy: {
    mode: "read_only",
    summary: "Local fixture only",
    allowedMarkets: ["SOL-PERP"],
    entryRules: "Review before action",
    exitRules: "No live execution",
    riskRules: "Blocked",
    executionProtocol: "Synthetic review",
    killSwitchRules: "No execution",
    updatedAt: stamp,
  },
  publishing: {
    status: "published",
    slug: "review-trader",
    publicSummary: "Synthetic local review profile; not a live trader.",
    moderation: {
      status: "approved",
      reason: "Synthetic fixture only",
      reviewedBy: "local-fixture",
      updatedAt: stamp,
      version: 1,
    },
    visibleMetrics: [],
    updatedAt: stamp,
    version: 1,
  },
};
const scope = crypto
  .createHash("sha256")
  .update(
    JSON.stringify([
      "clearsig.agent.local-scope.v2",
      "fixture-only-subject",
      pk(2),
      pk(9),
      "53aZBmukjX5sYxbrYVRDd2DWzsRWVmvVFPY6PcyomR5v",
    ]),
  )
  .digest("hex");
const storage = {
  ["clear.agents.v2:" + scope]: JSON.stringify({
    version: 1,
    agentsByWallet: { operations: [agent] },
  }),
  "clear.policies.v1": JSON.stringify({
    version: 1,
    byWallet: {
      operations: [
        {
          id: "review-policy",
          walletName: "operations",
          name: "Review policy",
          description: "Synthetic authoring cache only",
          priority: 1,
          enabled: true,
          conditions: [],
          action: "deny",
          createdAt: stamp,
          updatedAt: stamp,
          version: 1,
        },
      ],
    },
  }),
};
module.exports = { storage, agent, pk };
