// Endpoint-level service methods keep route paths out of UI components.
//
// Two kinds of write endpoints:
//   - prepare.*  . POSTs to /prepare/**, returns a DryRunDescriptor the
//                  caller feeds into `wallet.signMessage`.
//   - submit.*   . POSTs to the real route with a PreSigned payload.
//
// Reads are unchanged: GETs + the /health probe.
import { apiRequest } from "@/lib/api/client";
import { appConfig } from "@/lib/config";
import { withRetry } from "@/lib/api/retry";
import type {
  AddChainInput,
  CreateWalletInput,
  DryRunDescriptor,
  ExecuteProposalInput,
  PrepareAddIntentInput,
  PrepareApproveCancelInput,
  PrepareCreateProposalInput,
  PrepareRemoveIntentInput,
  PrepareUpdateIntentInput,
  SignedAddIntentInput,
  SignedApproveCancelInput,
  SignedCreateProposalInput,
  SignedRemoveIntentInput,
  SignedUpdateIntentInput,
  WalletChainsResponse
} from "@/lib/api/types";

export const backendApi = {
  health: () => apiRequest<{ status: string; cli_bin: string }>("/health", "GET"),
  memberships: (address: string) =>
    apiRequest<Record<string, unknown>>(`/memberships?address=${encodeURIComponent(address)}`, "GET"),

  // Bootstrap ops (no user signature required . on-chain instructions are
  // payed for and submitted by the relayer's sponsored-gas keypair).
  // Bootstrap chains multiple ixns + RPC confirms; bump past the 30s
  // default so a slow first-time devnet round trip doesn't surface as
  // a misleading timeout. Wrapped in withRetry so a single transient
  // RPC blip ("blockhash not found", "node is behind") doesn't fail
  // the whole flow.
  createWallet: (input: CreateWalletInput) =>
    withRetry(() =>
      apiRequest<Record<string, unknown>, CreateWalletInput>("/wallets", "POST", input, {
        timeoutMs: 60_000,
      }),
    ),
  showWallet: (walletName: string) =>
    apiRequest<Record<string, unknown>>(`/wallets/${encodeURIComponent(walletName)}`, "GET"),
  listWalletChains: (walletName: string) =>
    apiRequest<WalletChainsResponse>(
      `/wallets/${encodeURIComponent(walletName)}/chains`,
      "GET",
    ),
  // DKG runs through Ika's pre-alpha network; the UI explicitly tells
  // the user it can take >30s, so the request must outlive that
  // window. 3 minutes gives headroom for retries.
  addWalletChain: (walletName: string, input: AddChainInput) =>
    withRetry(
      () =>
        apiRequest<Record<string, unknown>, AddChainInput>(
          `/wallets/${encodeURIComponent(walletName)}/chains/add`,
          "POST",
          input,
          { timeoutMs: 180_000 },
        ),
      // DKG is expensive to redo, so cap to a single retry with a
      // longer wait — the most common transient is the post-DKG
      // confirm being a beat behind the cluster.
      { maxAttempts: 2, delayMs: 1500 },
    ),

  // Reads.
  listIntents: (walletName: string) =>
    apiRequest<unknown[]>(`/wallets/${encodeURIComponent(walletName)}/intents`, "GET"),
  listProposals: (walletName: string) =>
    apiRequest<unknown[]>(`/wallets/${encodeURIComponent(walletName)}/proposals`, "GET"),
  showProposal: (proposalAddress: string) =>
    apiRequest<Record<string, unknown>>(`/proposals/${encodeURIComponent(proposalAddress)}`, "GET"),

  // ── Dry-run "what do I sign?" routes ──────────────────────────────────
  prepare: {
    addIntent: (walletName: string, input: PrepareAddIntentInput) =>
      apiRequest<DryRunDescriptor, PrepareAddIntentInput>(
        `/prepare/wallets/${encodeURIComponent(walletName)}/intents/add`,
        "POST",
        input
      ),
    removeIntent: (walletName: string, input: PrepareRemoveIntentInput) =>
      apiRequest<DryRunDescriptor, PrepareRemoveIntentInput>(
        `/prepare/wallets/${encodeURIComponent(walletName)}/intents/remove`,
        "POST",
        input
      ),
    updateIntent: (walletName: string, input: PrepareUpdateIntentInput) =>
      apiRequest<DryRunDescriptor, PrepareUpdateIntentInput>(
        `/prepare/wallets/${encodeURIComponent(walletName)}/intents/update`,
        "POST",
        input
      ),
    createProposal: (walletName: string, input: PrepareCreateProposalInput) =>
      apiRequest<DryRunDescriptor, PrepareCreateProposalInput>(
        `/prepare/wallets/${encodeURIComponent(walletName)}/proposals/create`,
        "POST",
        input
      ),
    approveProposal: (walletName: string, proposalAddress: string, input: PrepareApproveCancelInput) =>
      apiRequest<DryRunDescriptor, PrepareApproveCancelInput>(
        `/prepare/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/approve`,
        "POST",
        input
      ),
    cancelProposal: (walletName: string, proposalAddress: string, input: PrepareApproveCancelInput) =>
      apiRequest<DryRunDescriptor, PrepareApproveCancelInput>(
        `/prepare/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/cancel`,
        "POST",
        input
      )
  },

  // ── Signed submit routes ─────────────────────────────────────────────
  //
  // Every submit is wrapped in withRetry: signed payloads bind to a
  // fixed proposal index + nonce, so retrying targets the same slot.
  // If the original landed silently, the retry fails fast with an
  // "already" hint that friendlyError surfaces as "this request has
  // already been handled". User rejections + rate limits do NOT
  // retry — see lib/api/retry.ts for the predicate.
  submit: {
    addIntent: (walletName: string, input: SignedAddIntentInput) =>
      withRetry(() =>
        apiRequest<Record<string, unknown>, SignedAddIntentInput>(
          `/wallets/${encodeURIComponent(walletName)}/intents/add`,
          "POST",
          input
        ),
      ),
    removeIntent: (walletName: string, input: SignedRemoveIntentInput) =>
      withRetry(() =>
        apiRequest<Record<string, unknown>, SignedRemoveIntentInput>(
          `/wallets/${encodeURIComponent(walletName)}/intents/remove`,
          "POST",
          input
        ),
      ),
    updateIntent: (walletName: string, input: SignedUpdateIntentInput) =>
      withRetry(() =>
        apiRequest<Record<string, unknown>, SignedUpdateIntentInput>(
          `/wallets/${encodeURIComponent(walletName)}/intents/update`,
          "POST",
          input
        ),
      ),
    createProposal: (walletName: string, input: SignedCreateProposalInput) =>
      withRetry(() =>
        apiRequest<Record<string, unknown>, SignedCreateProposalInput>(
          `/wallets/${encodeURIComponent(walletName)}/proposals`,
          "POST",
          input
        ),
      ),
    approveProposal: (walletName: string, proposalAddress: string, input: SignedApproveCancelInput) =>
      withRetry(() =>
        apiRequest<Record<string, unknown>, SignedApproveCancelInput>(
          `/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/approve`,
          "POST",
          input
        ),
      ),
    cancelProposal: (walletName: string, proposalAddress: string, input: SignedApproveCancelInput) =>
      withRetry(() =>
        apiRequest<Record<string, unknown>, SignedApproveCancelInput>(
          `/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/cancel`,
          "POST",
          input
        ),
      )
  },

  executeProposal: (walletName: string, proposalAddress: string, input: ExecuteProposalInput) =>
    withRetry(() =>
      apiRequest<Record<string, unknown>, ExecuteProposalInput>(
        `/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/execute`,
        "POST",
        input
      ),
    ),

  cleanupProposal: (proposalAddress: string) =>
    apiRequest<Record<string, unknown>, Record<string, never>>(
      `/proposals/${encodeURIComponent(proposalAddress)}/cleanup`,
      "POST",
      {}
    )
};

// ── SSE URL builder for streaming execute ──────────────────────────────
//
// The browser opens an EventSource to this URL; the backend pipes
// `clear-msig proposal execute` stderr as `progress` events, then emits
// a final `done` event with the JSON result. UI wiring in Phase 5.5.
export function executeProposalStreamUrl(
  walletName: string,
  proposalAddress: string,
  params: ExecuteProposalInput
): string {
  const q = new URLSearchParams();
  if (params.dwallet_program) q.set("dwallet_program", params.dwallet_program);
  if (params.grpc_url) q.set("grpc_url", params.grpc_url);
  if (params.rpc_url) q.set("rpc_url", params.rpc_url);
  if (params.broadcast !== undefined) q.set("broadcast", String(params.broadcast));
  const base = appConfig.backendApiUrl;
  const path = `/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/execute/stream`;
  return `${base}${path}${q.toString() ? "?" + q.toString() : ""}`;
}

// ── Back-compat shims kept while Phase 5 rewrites the hooks ────────────
//
// Each points at a `/prepare/**` route so the old call signatures keep
// typechecking. The DryRunDescriptor returned is fine for the existing
// ResponseViewer panels until the typed-form + signMessage flow lands.

export const backendApiLegacy = {
  addIntent: (walletName: string, input: PrepareAddIntentInput) =>
    backendApi.prepare.addIntent(walletName, input),
  removeIntent: (walletName: string, index: number) =>
    backendApi.prepare.removeIntent(walletName, { index }),
  updateIntent: (
    walletName: string,
    input: PrepareUpdateIntentInput
  ) => backendApi.prepare.updateIntent(walletName, input),
  createProposal: (walletName: string, input: PrepareCreateProposalInput) =>
    backendApi.prepare.createProposal(walletName, input),
  approveProposal: (walletName: string, proposalAddress: string) =>
    backendApi.prepare.approveProposal(walletName, proposalAddress, {}),
  cancelProposal: (walletName: string, proposalAddress: string) =>
    backendApi.prepare.cancelProposal(walletName, proposalAddress, {})
};
