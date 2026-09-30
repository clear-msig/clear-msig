# Agent API authorization and v2 signal migration

Private agent state GET/POST, inbox GET/DELETE and interactive register/import,
autonomy ticks, wallet-scoped execution history, execution writes, and settlement
writes require a signed Dynamic bearer plus current on-chain treasury membership.
The shared verifier pins JWT issuer/environment/audience and RS256 signature.
Only signed verified Solana credentials matching the approved, program-owned
intent-0 proposer/approver roster are members. Every request re-resolves the exact
unique canonical wallet PDA and re-reads the governance roster. Missing sessions,
ambiguous names, revoked membership, wrong owners/PDA/intent, and RPC failures
fail closed. Same-origin checks are CSRF defense only; `approvedBy`, local session
subjects, management passwords and connected hardware wallets do not establish
membership. Persisted signed owner approvals additionally require that the actual
approval signer belongs to the freshly verified full governance roster; member
relayers cannot relabel unrelated keys as owners. Browser adapters read the current bearer getter for each request.

The boundary supplies the verified PDA to request-scoped v2 storage. Domain
storage rejects calls without this scope. Keys include canonical wallet identity
and verified chain genesis/program identity. Genesis comes from the fixed server
RPC connection and must match the optional deployment expected-genesis pin;
provider/API-key rotation does not create a new namespace. Legacy name-only server data is
not read or silently migrated; an audited, explicit migration is required before
adopting historical state. Members must register fresh signal connections.
Public published profiles, approved marketplace listings, market data and bare
venue readiness remain public. Bare readiness does not disclose the configured
server account or executor probe. Explicit public account-address market reads
remain available; wallet execution history is private and noncacheable.

External signal submission uses a scoped registered submit-only key and mandatory
`hmac_sha256_v2`. The signature covers the exact recursively key-sorted envelope
`{domain:"clearsig.agent.signal",scheme:"hmac_sha256_v2",target,signal}`.
The nonsecret `target` returned by authenticated registration includes the
canonical wallet address, agent ID, program ID and server deployment/network
namespace. A display name is not a signature target. Required `clientSignalId`
and `submittedAt` bind retry nonce and freshness. The route verifies the original
submitted object before normalization; bounded streaming body limits apply.
Ten-minute maximum age, two-minute future skew, retained nonce deduplication
and per-target key checks prevent stale and cross-target reuse. Origin restrictions
remain abuse controls, never authentication. Key-only and v1 legacy submissions
are rejected. The example SDK, runner and connection screen explain migration.

Membership grants access to private agent records; it is not threshold authority
to trade, move funds, close positions or claim settlement. Trusted venue delivery
still requires the separate canonical bridge and immutable on-chain commitments.
Settlement PATCH proof promotion deliberately returns 409 until a pinned chain
reader and immutable claim store verify the exact typed settlement commitment.
A generic executed proposal, client-reported transaction ID or arbitrary proposal
address cannot promote settlement metadata.
