# Security model

Honest accounting of attack surfaces in Clear today + what's mitigated, what's open, and what's deferred. Written by walking the codebase as an attacker would; updated when the model changes.

The product is in pre-alpha. Some load-bearing mitigations (FHE-encrypted policies, on-chain cap enforcement) ride on the Encrypt network going live. Until then, any "encrypted" or "private" badging in the UI is forward-looking, and the in-app chips say "pre-alpha" to make that explicit.

## Attack surfaces

### A. Sign-payload substitution (highest impact)

**Vector.** *Software* Solana wallets (Phantom, Solflare, embedded Dynamic) render `signMessage` bytes as raw hex. The user's only window into "what am I about to sign" is whatever the frontend tells them in `<SignPayloadPreview>`. A malicious *backend* could swap the bytes between the structured preview and the wallet prompt: the user reads "Send $5 to Sarah" but signs "Send everything to attacker." A Ledger device sidesteps this entirely (see below).

**Mitigation today (software wallet path).**
- `<SignPayloadPreview>` shows the structured intent above the wallet popup so the user knows what was *requested*.
- `<WalletPopupNarration>` adapts its copy: software wallets get the "technical-looking text is normal" disclaimer, Ledger users get "read the device — it shows the full message."
- For contact-resolved sends, `<SignPayloadPreview>` shows the abbreviated destination address alongside the contact name, so a `localStorage`-tampered contact (see C) is easier to spot.
- Strict CSP (`frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`) closes the trivial frame-injection paths a hostile script might use to host a fake wallet popup.
- **Client-side sign-payload rebuild + verify.** Every signed write goes through `signDescriptor()` in `useSignWithWallet`. The hook fetches the on-chain intent account from Solana RPC, parses it, rebuilds the offchain-wrapped signable bytes locally with `buildSignableMessage`, and byte-compares against the descriptor's `message_hex` before opening the wallet popup. A mismatch throws `WalletSignError("message_mismatch")`. The wallet signs the locally-rebuilt bytes, not the backend-supplied bytes. See `frontend/src/lib/msig/verify.ts`.

**Mitigation today (Ledger path — closes this surface end-to-end).**
- Ledger over WebHID is a first-class signer in the retail app. `useWallet` prefers an active `LedgerSession` over Dynamic; all signing routes through `Solana.signOffchainMessage` on the device.
- The bytes we hand the device are exactly `wrapOffchain(body)` — the Solana app detects the `\xffsolana offchain` magic prefix + format-byte 0 (restricted ASCII) and renders the message body as plain text on the device screen. The user reads `expires 2030-01-01: approve transfer 1000000000 lamports to 9abc... | wallet: treasury proposal: 42` directly on a hardware display. No frontend rendering layer between the user and the bytes.
- Connect entry points: `/connect` (subdued option below the Dynamic widget) and `/security` (primary CTA card). Both surface friendly error states (`no_device`, `app_closed`, `rejected`, `transport_lost`).

**What this does NOT mitigate.** Same-origin XSS that calls `signMessage` directly bypasses the verify hook for software wallets. The Ledger path is robust to that too — the device shows the message regardless of the host. The chain is now the trusted source of truth for intent shape; if an attacker controls the chain account itself (e.g. compromises the multisig majority) they can shape arbitrary intents — different surface (see I).

**Status.** Closed end-to-end on the Ledger path; closed at the byte-equality level for software wallets via `signDescriptor`. Track regressions: every new signed flow must call `signDescriptor`, never `signBytes(fromHex(...))`.

### B. Open-redirect via `?next=`

**Vector.** `/connect?next=//attacker.com` — after sign-in, `useWalletGate` honours the `next` query param. Without strict validation, a protocol-relative `//host` redirects off-domain.

**Mitigation today.** `isSafeNext()` in `useWalletGate.ts` rejects: empty, `//`, `/\\`, anything with `:` in the first path segment. Only single-leading-slash same-origin paths pass.

### C. `localStorage` tampering

**Vector.** Contacts (`name → address` map), watchers, allowances, and batch records all live in `localStorage`. Same-origin JS access (XSS, browser extension, shared device) can swap a contact's address. Future sends to that name silently route to the attacker's address.

**Mitigation today.**
- `<SignPayloadPreview>` always shows the abbreviated destination address, even for contact-resolved sends (see A).
- The post-send `<PastedAddressNotice>` warns about raw addresses without contact match.
- Contact entries now carry an HMAC-SHA256 signature keyed by a per-device secret (`clear.contacts.integritykey.v1`). Mismatched entries are dropped on load and the contacts page shows a tamper warning. This raises the bar against DevTools edits, key-by-key extension tampering, and forged JSON imports.

**What this does NOT mitigate.** A user who skims the preview without reading the address still misses the swap. HMAC integrity does not stop XSS — same-origin JS reads both the device key and the entries. Real fix needs an integrity-protected contact store (e.g. signed contact list synced via the user's wallet) — out of scope for MVP.

### D. XSS

**Vector.** User-provided strings (wallet name, member name, note, contact name) reach React rendering paths.

**Mitigation today.**
- React auto-escapes by default. The codebase has zero uses of `dangerouslySetInnerHTML`. Confirmed: `grep -r dangerouslySetInnerHTML src/` returns nothing. No `innerHTML =`, no `eval(`, no `postMessage` listeners.
- Strict CSP defence-in-depth: `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`. Enforced policy still allows inline scripts/styles (Next 15 hydration + framer-motion + Tailwind runtime need them).
- Per-request nonce + `'strict-dynamic'` CSP shipped as `Content-Security-Policy-Report-Only` via `frontend/src/middleware.ts`. Modern browsers report violations to console without blocking; once the violation report is clean we flip the header name from `-Report-Only` to enforcing in one line. Server components can read the nonce via `headers().get('x-nonce')` for any custom `<Script>` they emit.
- Email template (`buildMultisigInviteEmail`) escapes every interpolated value.

**Caveat.** SVG / icon libraries we depend on (lucide-react, framer-motion) need their own audits. Worth a periodic `npm audit` pass — see surface M.

### E. NL endpoint abuse

**Vector.** `/api/nl/parse` and `/api/nl/route` make a paid Anthropic call per request. A scripted attacker can run the call in a loop and rack up the API key's bill.

**Mitigation today.**
- Both endpoints clamp body sizes (`MAX_TEXT_LEN = 280`).
- Both clamp the model's max tokens (256 / 384).
- Both fast-fail when `ANTHROPIC_API_KEY` is missing (503).
- `assertSameOrigin` rejects any request whose `Origin` (or fallback `Referer`) does not match the deployment host. Closes the trivial cross-origin POST.
- Per-IP token-bucket rate limit (`checkRateLimit`): 20 burst, 1/sec sustained. In-process Map keyed on `x-forwarded-for` with periodic pruning.

**What this does NOT mitigate.** Same-origin XSS or a phishing page on the same origin would bypass the origin check.

**Upstash adapter (live when configured).** `checkRateLimit` now reads `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`; when both are set it pipes `INCR` + `EXPIRE NX` to Upstash so all Vercel instances share state, then runs the in-process bucket as belt-and-braces. Failed REST calls fail-open (don't block real users on a KV outage); the in-process limiter still catches obvious loops. With Upstash configured, the cold-start parallel-attack hole closes.

### F. CSRF on signed mutations

**Vector.** Backend POST endpoints accept any request bearing a valid pre-signed payload. An XSS or phishing page on the same origin could trigger sign + submit without user intent.

**Mitigation today.**
- The signed payload includes the user's pubkey + the message bytes; replay on the same proposal index is benign (program rejects). Single-use nonces in proposal create payloads block replay across proposals.
- All Next.js API routes (`/api/nl/parse`, `/api/nl/route`, `/api/invitations`) reject any request without a same-origin `Origin` header via `assertSameOrigin`. This closes the trivial "POST it from elsewhere" hole.

**What this does NOT mitigate.** If an attacker can get the user to sign a fresh message bytes (e.g. via XSS-injected sign call), the resulting submission lands. The wallet popup is the only consent step — see A.

### G. Phishing

**Vector.** Look-alike `clear-msig.vercel.app`-style domains. Dynamic auth + the email signup mean a phishing site can mint a real Solana wallet under attacker control while the user thinks they're signing into Clear.

**Mitigation today.**
- The new `/security` page tells users to bookmark the canonical URL and to close the tab if anything looks off. Linked from settings, so the answer to "is this safe?" has an in-app destination.
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` blocks downgrade attacks once the user has visited once.
- `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'` prevents the real site from being framed inside a phishing wrapper.

**Real fix (deferred).** Eventually: ENS-style human-readable wallet identifiers, app store distribution, hardware-key sign options for high-value wallets.

### H. Sign-then-broadcast race on EVM

**Vector.** Frontend fetches EVM nonce via `eth_getTransactionCount(pending)`, signs, hands off to Ika for broadcast. If the user's EVM address has a tx land in between, the signed tx becomes nonce-too-low (rejected, no fund loss).

**Mitigation today.** No fund loss possible (Ethereum rejects out-of-order nonces). Worst case: tx fails late and the user sees "couldn't broadcast." We use `pending` so a same-block resubmit picks the next available nonce.

### I. Member privilege escalation

**Vector.** A wallet member could try to add themselves to a more-privileged role via `UpdateIntent` without majority approval.

**Mitigation today.** The Solana program enforces approval threshold for any intent mutation. With threshold > 1, a single member can't unilaterally promote themselves.

**Caveat.** Threshold-1 wallets (the default for solo `just_me` create) have no enforcement — but a solo wallet has only one member by definition.

### J. Race condition in batch send

**Vector.** Batch send fires N proposals in series. Between two rows, the proposal index could be claimed by an external party (someone using the CLI directly), leading to PDA collision on the second submit.

**Mitigation today.** `useBatchSend` waits 600ms between rows for `confirmed` reads to catch up + retries on `RETRYABLE_HINTS` (PDA collision is one). Per-row failures don't poison the rest of the batch.

### N. Hardware-wallet path (Ledger) — strongest signing tier

**Vector / motivation.** This is not a vulnerability — it's the hardening tier the upstream `Iamknownasfesal/clear-msig-ika` repo's "clear signing" claim was built around, and the one most retail flows opt out of by going email-first.

**Mitigation today.**
- `frontend/src/lib/wallet/ledger.ts` connects via `@ledgerhq/hw-transport-webhid` and signs via `Solana.signOffchainMessage`. The bytes handed over are exactly the `wrapOffchain(body)` output, so the Solana app on the device renders the body as text and asks the user to confirm on hardware.
- `LedgerProvider` + `useLedger` give the rest of the app a `session` to read; `useWallet` prefers it over Dynamic.
- `/connect` and `/security` both expose connect buttons. Friendly error mapping for "no device", "app not open", "rejected on device", "transport lost".

**What this does NOT do.**
- Persist the session across page reloads. WebHID needs a re-grant per origin per device, and the Solana app must be unlocked, so a silent reconnect would be confusing. Users re-tap "Connect Ledger" each session.
- Cover non-Solana chains. Cross-chain signs (ETH, BTC, ZEC) still go through Ika dWallet using a Solana ed25519 signature as the proof; the Ledger covers that Solana ed25519 step. The user does not need a separate Ledger app per chain.

### K. Embedded wallet (Dynamic) compromise

**Vector.** Email-based wallets are recoverable via email — if attacker compromises the user's email, they can take over the wallet via Dynamic's "sign in with email" flow.

**Mitigation today.**
- Dynamic uses TSS-MPC for the embedded wallet's private key, so single-server compromise doesn't leak the key.
- The shared-wallet model itself: a 2-of-3 wallet requires email-compromise of 2 members to drain.
- The `/security` page now has an **Add passkey** button wired to `useRegisterPasskey()` from the Dynamic SDK. Logged-in users with passkey-eligible wallets see a single-click registration flow; users who already have a passkey see the success state. No extra hop through Dynamic's user-profile modal.

**Real fix (deferred).** Pop the passkey prompt inline at wallet-create time for any wallet flagged as high-value, so it's not opt-in for users that hold real money.

### L. SMTP abuse via `/api/invitations`

**Vector.** The invitation endpoint speaks SMTP from a branded sender. Without rate limiting it is a free spam relay; with attacker-controlled `walletName`/`reason` it becomes a phishing template under our domain (a real "invite to Clear" email crafted by an attacker, sent to anyone).

**Mitigation today.**
- `assertSameOrigin` closes the cross-origin POST.
- Tight token-bucket rate limit (5 burst, 1 every 30 seconds per IP). A real signer never trips this.
- Body fields are length-clamped and stripped of CR/LF/control characters before they reach nodemailer (defence-in-depth on top of nodemailer's own header sanitization).
- Email + base58 address fields are regex-validated; malformed values 400 before SMTP fires.
- `nodemailer` bumped to v8 to clear several SMTP-command-injection CVEs (`GHSA-vvjj-xcjg-gr5g`, `GHSA-c7w3-x93f-qmm8`, etc.).

**What this does NOT mitigate.** A spammer running through a botnet of cold Vercel instances can still exceed the in-process budget. Real fix is the same KV-backed limiter as surface E.

### M. Dependency vulnerabilities

**Vector.** Transitive dependencies bring known CVEs into the runtime.

**Mitigation today.**
- Removed the entire `@solana/wallet-adapter-*` package family (dead code after the Dynamic migration). This cleared 700+ packages and 8 critical vulns including `protobufjs` arbitrary code execution (via the Trezor adapter we never used).
- `nodemailer` bumped to v8 (multiple SMTP-injection fixes).
- `npm audit --omit=dev` now reports 0 critical, 10 high — all transitive through `@dynamic-labs/*` and `@solana/spl-token`. The high-severity items (axios DoS / SSRF, lodash prototype pollution, bigint-buffer overflow) are not directly reachable from our code paths: we never hand attacker-controlled URLs to axios, never call `_.template`/`_.unset` with user paths, and Solana token amount parsing comes from chain rather than user input.

**What this does NOT mitigate.** Upstream-blocked. When Dynamic and `@solana/spl-token` ship updated transitives, re-run `npm audit` and bump.

## Posture summary

What's solid today:
- React + auto-escape against XSS
- Strict security headers (HSTS, CSP, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy, X-Content-Type-Options)
- Per-request CSP nonce + strict-dynamic shadowed in report-only mode
- Validated `?next=` against open-redirect
- **Ledger clear signing on the device.** The Solana app on the user's Ledger renders the offchain message body as text on the device screen via `signOffchainMessage`; the host is bypassed for the consent step.
- **Client-side sign-payload rebuild + verify** for software wallet users (defends the same surface from the host side).
- localStorage destination shown in sign preview
- HMAC-signed contacts; tampered entries dropped on load
- Same-origin guard + per-IP rate limit on every Next API route
- Optional Upstash adapter for shared rate-limit state across Vercel instances
- One-click passkey enrollment for embedded-wallet users on /security
- SMTP body sanitization + tight invite limits
- Replay protection via signed nonce in messages
- TSS-MPC keys via Dynamic (single-host compromise resistant)
- Pre-alpha caveat on every "encrypted" / "private" chip
- 0 critical npm vulns; high-severity remainders are transitive + non-reachable

What's load-bearing pre-alpha and ships when the network does:
- FHE-encrypted policies (Encrypt network not yet live)
- On-chain enforcement of allowances + budgets

What's deferred to post-MVP:
- Hardware key sign option for high-value wallets (see K).
- Inline passkey prompt at wallet-create time for high-value wallets (see K). Today the prompt lives behind one button on `/security`; it's wired but opt-in.
- Flipping nonce-based CSP from report-only to enforcing (see D). Needs a few days of observed violation reports on production traffic to confirm Dynamic's runtime + framer-motion don't trip on the strict policy.

If you find an issue not in this list, file it with [INSERT REPORTING CHANNEL] before disclosing publicly.
