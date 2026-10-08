// Isolated provider/RPC boundaries; real gate, query client, parser and UI.
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ConnectRuntimeIsland from "@/app/connect/ConnectRuntimeIsland";
window.fixture = {
  account: "11111111111111111111111111111111", endpoint: "https://rpc-a.fixture.invalid",
  mode: "failure", calls: [], pending: [], navigations: [], ...window.initialFixture,
};
window.updateFixture = (values) => {
  Object.assign(window.fixture, values);
  window.dispatchEvent(new Event("fixture-update"));
};
window.fixtureRead = async (source, address, endpoint) => {
  const f = window.fixture;
  f.calls.push({ source, address, endpoint });
  if (f.mode === "pending") return new Promise(resolve => f.pending.push({ source, address, endpoint, resolve }));
  if (f.mode === "failure" || (source === "rpc" && f.mode === "malformed")) throw Error("Synthetic read failure");
  const rows = f.mode === "empty" ? [] : [
    { wallet: "So11111111111111111111111111111111111111112", wallet_name: f.mode === "unnamed" ? undefined : "pro-team", roles: ["approver"], intent_indexes: [0] },
    ...(f.mode === "multiple" ? [{ wallet: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", wallet_name: "pro-second", roles: ["approver"], intent_indexes: [0] }] : []),
  ];
  return source === "rpc" ? rows : f.mode === "malformed" ? {} : { organizations: rows };
};
const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
window.fixtureClient = client;
createRoot(document.getElementById("root")).render(<QueryClientProvider client={client}><ConnectRuntimeIsland environmentId="synthetic" autoOpen={false} reduce={true} destination={null} /></QueryClientProvider>);
