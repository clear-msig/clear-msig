import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TeamSetupChecklist } from "@/components/wallet/detail/TeamSetupChecklist";
import AddMember from "@/app/app/wallet/[name]/members/add/page";
import { savePendingTeammates } from "@/lib/retail/setupChecklist";
const key = (n) =>
  [
    "11111111111111111111111111111111",
    "So11111111111111111111111111111111111111112",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    "Vote111111111111111111111111111111111111111",
  ][n];
const rule = (intentIndex, approvers, approvalThreshold, intentType = 3) => ({
  index: intentIndex,
  pda: { toBase58: () => `rule${intentIndex}` },
  account: {
    approved: true,
    intentIndex,
    intentType,
    chainKind: 0,
    approvers,
    proposers: [key(0)],
    approvalThreshold,
    cancellationThreshold: 1,
    timelockSeconds: 0,
  },
});
window.fixture = {
  wallet: {
    pda: { toBase58: () => key(0) },
    account: { creator: key(0), intentIndex: 7 },
  },
  intents: [
    rule(3, [key(0)], 1),
    rule(7, [key(1), key(2)], 2),
    rule(2, [key(0)], 1, 2),
  ],
  address: key(2),
};
savePendingTeammates("Synthetic", [key(2)]);
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
createRoot(document.getElementById("root")).render(
  <QueryClientProvider client={client}>
    <main className="mx-auto max-w-2xl space-y-4 p-4">
      <p className="text-sm text-text-soft">
        Synthetic local component review — no live wallet or signing.
      </p>
      {location.pathname.includes("/members/add") ? (
        <AddMember />
      ) : (
        <TeamSetupChecklist
          walletName="Synthetic"
          intents={window.fixture.intents}
          creator={key(0)}
        />
      )}
    </main>
  </QueryClientProvider>,
);
