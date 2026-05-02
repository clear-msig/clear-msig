// Friendly error mapping — translates backend / wallet / signing
// errors into a `{ title, body }` retail user can act on.
//
// Source signals:
//   - BackendApiError: HTTP-side failures with a structured payload
//     (`error`, `kind`, `code`, `stderr`, `stdout`, `retry_after_secs`).
//   - WalletSignError: user cancelled, wallet doesn't support
//     signMessage, or wallet returned an unexpected blob.
//   - TypeError("Failed to fetch"): network-level failure (backend
//     down, DNS, etc.). Captured by string match.
//
// Pattern matching strategy: we walk through known error signatures
// in priority order. Specific cases fire first (e.g. "already bound"
// → friendly explanation about chain duplicates); generic fallback
// returns the raw message so users always see *something* useful.
//
// Add new mappings as backend errors surface in real usage. Keep
// the body short, action-oriented, and never blame the user.

import { BackendApiError } from "@/lib/api/client";
import { WalletSignError } from "@/lib/hooks/useSignWithWallet";
import { PolicyViolationError } from "@/lib/retail/policyEvaluation";
import { appConfig } from "@/lib/config";

export interface FriendlyError {
  /// Short headline shown as the toast message.
  title: string;
  /// Action-oriented hint shown in the toast's `details` panel.
  /// Keep concise — one or two short sentences.
  body?: string;
  /// Override the toast's auto-dismiss timing. Defaults to undefined
  /// (the toast layer's standard 5s for errors).
  durationMs?: number;
}

interface SignalBag {
  message: string;
  payloadError: string;
  stderr: string;
  stdout: string;
  retryAfterSecs?: number;
  isNetwork: boolean;
  isWalletReject: boolean;
  /// Set when the wallet error is a Ledger device-state issue
  /// (transport, app-not-open, etc.) rather than a real user reject.
  walletErrorCode?: WalletSignError["code"];
}

function bagFromError(err: unknown): SignalBag {
  let message = "";
  let payloadError = "";
  let stderr = "";
  let stdout = "";
  let retryAfterSecs: number | undefined;
  let isNetwork = false;
  let isWalletReject = false;

  let walletErrorCode: WalletSignError["code"] | undefined;

  if (err instanceof BackendApiError) {
    message = err.message ?? "";
    payloadError = err.payload?.error ?? "";
    stderr = err.payload?.stderr ?? "";
    stdout = err.payload?.stdout ?? "";
    retryAfterSecs = err.payload?.retry_after_secs;
  } else if (err instanceof WalletSignError) {
    message = err.message ?? "";
    isWalletReject = err.code === "rejected";
    walletErrorCode = err.code;
  } else if (err instanceof Error) {
    message = err.message ?? "";
  } else if (typeof err === "string") {
    message = err;
  }

  // Network failure detection. Browsers throw `TypeError("Failed to
  // fetch")` (Chrome/Edge/Safari) or `"NetworkError when attempting
  // to fetch resource."` (Firefox) when the request never reaches a
  // server.
  isNetwork =
    message === "Failed to fetch" ||
    message === "NetworkError when attempting to fetch resource." ||
    message.toLowerCase().includes("failed to fetch");

  return {
    message,
    payloadError,
    stderr,
    stdout,
    retryAfterSecs,
    isNetwork,
    isWalletReject,
    walletErrorCode,
  };
}

/// All-strings haystack for substring matching across error layers.
function haystack(b: SignalBag): string {
  return `${b.message}\n${b.payloadError}\n${b.stderr}\n${b.stdout}`.toLowerCase();
}

export type ActionContext =
  | "create-wallet"
  | "add-chain"
  | "set-up-spending"
  | "send"
  | "approve"
  | "decline"
  | "add-friend"
  | "generic";

/// Map any error into a retail-friendly `{ title, body }`. The
/// `context` argument lets us tailor the message to the action the
/// user just attempted ("Couldn't create wallet" vs "Couldn't send").
export function friendlyError(
  err: unknown,
  context: ActionContext = "generic",
): FriendlyError {
  // ── Wallet policy: pre-flight check rejected the send ─────────
  // PolicyViolationError fires BEFORE any network or wallet step,
  // so it has the cleanest title + body of any error class. Show
  // verbatim — the violation copy is already action-oriented.
  if (err instanceof PolicyViolationError) {
    return { title: err.message, body: err.body };
  }

  const bag = bagFromError(err);
  const hay = haystack(bag);

  // ── Network: backend unreachable ──────────────────────────────
  if (bag.isNetwork) {
    return {
      title: "We can't reach Clear right now",
      body:
        `Tried ${appConfig.backendApiUrl}. ` +
        "Check your connection, then try again. If you're running " +
        "locally, start the backend with `cargo run -p clear-msig-backend-api`.",
    };
  }

  // ── Wallet UX: Ledger device-state errors (app closed, etc.) ──
  // These came in as "rejected" before, telling users they cancelled
  // when their device just had the Solana app closed. Each code gets
  // the actionable next step.
  if (bag.walletErrorCode === "ledger_app_closed") {
    return {
      title: "Open the Solana app on your Ledger",
      body: "Unlock the device, open the Solana app, and tap the action again.",
    };
  }
  if (bag.walletErrorCode === "ledger_transport") {
    return {
      title: "Lost the connection to your Ledger",
      body: "Reconnect the cable, unlock the device, then try again.",
    };
  }
  if (bag.walletErrorCode === "ledger_unsupported") {
    return {
      title: "Hardware wallets need WebHID",
      body: "Open this page in Chrome, Edge, or Brave to use a Ledger.",
    };
  }

  // ── Wallet UX: user actually cancelled the signature ──────────
  if (bag.isWalletReject || hay.includes("user rejected") || hay.includes("user declined")) {
    return {
      title: "You cancelled the signature",
      body: "Nothing happened on chain. Try again whenever you're ready.",
    };
  }

  // ── Rate limited ──────────────────────────────────────────────
  if (
    bag.retryAfterSecs !== undefined ||
    hay.includes("rate limit") ||
    hay.includes("too many requests")
  ) {
    const retry = bag.retryAfterSecs ?? 30;
    return {
      title: "Slow down for a moment",
      body: `You've sent too many requests in a row. Try again in about ${retry} second${retry === 1 ? "" : "s"}.`,
    };
  }

  // ── Solana RPC: transient network state ───────────────────────
  // "blockhash not found" / "node is behind" usually mean the RPC
  // we hit is a beat behind the cluster. The CLI already retries on
  // these in some flows; surfacing them here covers the cases where
  // it bubbles up to the user (single-shot sends, create-wallet).
  if (
    hay.includes("blockhash not found") ||
    hay.includes("node is behind") ||
    hay.includes("nodebehind") ||
    hay.includes("slot was skipped") ||
    hay.includes("rpc response error -32007") ||
    hay.includes("rpc response error -32004") ||
    hay.includes("rpc response error -32014") ||
    hay.includes("rpc response error -32016")
  ) {
    return {
      title: "The network is catching up",
      body: "Solana's RPC is a beat behind. Wait a few seconds and try again.",
    };
  }

  // ── Solana RPC: simulation failure / preflight rejection ──────
  // -32002 covers a family: simulation failed, signature verification
  // failed, transaction precheck failed. The on-chain program emits
  // 23 specific WalletError variants; check those FIRST so the toast
  // shows what actually went wrong instead of a generic catch-all.
  if (
    hay.includes("rpc response error -32002") ||
    hay.includes("transaction simulation failed") ||
    hay.includes("transaction signature verification failed") ||
    hay.includes("transaction precheck failed") ||
    hay.match(/rpc response error -32002:\s*transaction\.?$/m)
  ) {
    const friendly = walletProgramErrorMessage(hay);
    if (friendly) return friendly;
    // Anchor / system error outside our catalogue. Try to surface
    // an actually informative stderr line — but ONLY if it looks
    // like prose. The previous version would happily prepend a
    // bare `}` from a JSON dump, producing toasts like
    // "} — wait a few seconds and try again". The picker now
    // refuses junk and the catch-all falls through to a clean
    // prose body when nothing prose-shaped is available.
    const tail = pickLastUsefulLine(bag);
    return {
      title: "Solana didn't accept that transaction",
      body: tail
        ? `${tail.slice(0, 220)} Wait a few seconds and try again. If it keeps failing, refresh the page and retry from a fresh state.`
        : "The network rejected this submission. Wait a few seconds and try again. " +
          "If the wallet name is new and it still fails, the previous attempt might still be confirming — refresh to see.",
    };
  }

  // ── Solana RPC: catch-all for any other -3200X error ──────────
  // Surface the code so a developer can grep, but give the user a
  // human "the network rejected it" framing instead of raw RPC text.
  const rpcCodeMatch = hay.match(/rpc response error (-32\d{3})/);
  if (rpcCodeMatch) {
    return {
      title: "Solana rejected the transaction",
      body: `The network refused the request (code ${rpcCodeMatch[1]}). Try again in a few seconds. If it keeps happening, refresh and retry from a fresh state.`,
    };
  }

  // ── Chain already bound (add-chain dedupe) ────────────────────
  if (
    hay.includes("already bound") ||
    hay.includes("ikaconfig") ||
    hay.includes("ika_config already") ||
    hay.includes("chain already")
  ) {
    return {
      title: "That chain is already on this wallet",
      body:
        "Give the previous setup a few seconds to finish, then refresh. " +
        "If the chain still doesn't show up, try again in a minute.",
    };
  }

  // ── Stuck pending proposal blocks new propose ────────────────
  // The on-chain `active_proposal_count` rejects a second proposal
  // on the same intent until the first is executed or cancelled. A
  // failed setup before this fix could leave that counter > 0 with
  // no way for the user to know what to do next.
  if (
    hay.includes("toomanyactiveproposals") ||
    hay.includes("too many active proposals") ||
    hay.includes("intent has active proposals")
  ) {
    return {
      title: "There's already a pending request on this rule",
      body:
        "Approve or cancel the existing request first, then try again. " +
        "Look in the wallet's request inbox; the one in 'Active' status " +
        "is blocking the new one.",
    };
  }

  // ── Proposal status mismatch on execute ──────────────────────
  if (hay.includes("must be 'approved' to execute") || hay.includes("must be approved to execute")) {
    return {
      title: "This request still needs approvals before it can run",
      body:
        "Approve it first (and ask any other friends required by the rule " +
        "to do the same). Once it's Approved, it can execute.",
    };
  }

  // ── Wallet name conflicts ─────────────────────────────────────
  // The on-chain program derives the wallet PDA from sha256(name)
  // alone (not creator-scoped), so names are globally unique on
  // devnet — any name a previous user took is permanently locked.
  // Anchor surfaces the conflict three different ways: as a system
  // error ("account already in use"), as an Anchor constraint
  // ("AlreadyInitialized"), and as a runtime error from the
  // create_account ix ("instruction requires an uninitialized
  // account"). All three end up here.
  if (
    context === "create-wallet" &&
    (hay.includes("already exists") ||
      hay.includes("alreadyinitialized") ||
      hay.includes("account already in use") ||
      hay.includes("instruction requires an uninitialized account"))
  ) {
    return {
      title: "That wallet name is already taken on devnet",
      body:
        "Wallet names are globally unique across the network. Try a more " +
        "specific name (your handle, a year, a couple of words) and create " +
        "again.",
    };
  }

  // ── Wallet name too long ──────────────────────────────────────
  if (
    context === "create-wallet" &&
    (hay.includes("name too long") ||
      hay.includes("string too long") ||
      hay.includes("exceeds max"))
  ) {
    return {
      title: "That name is too long",
      body: "Wallet names have to fit in 64 characters. Try something shorter.",
    };
  }

  // ── Threshold / approver-count math ───────────────────────────
  if (
    hay.includes("threshold") &&
    (hay.includes("exceeds") || hay.includes("must be") || hay.includes("less than"))
  ) {
    return {
      title: "Approval threshold doesn't fit the wallet",
      body:
        "The number of friends required to approve has to be at most " +
        "the number of friends in the wallet. Adjust and try again.",
    };
  }

  // ── Member / approver duplicate (add-friend) ──────────────────
  if (
    context === "add-friend" &&
    (hay.includes("already approver") ||
      hay.includes("approver already") ||
      hay.includes("duplicate approver"))
  ) {
    return {
      title: "That friend is already in the wallet",
      body: "Members are unique by address. You can't add the same address twice.",
    };
  }

  // ── Insufficient balance / funds ──────────────────────────────
  if (hay.includes("insufficient") || hay.includes("not enough")) {
    return {
      title: "Not enough money in this wallet",
      body:
        "The wallet needs more funds to cover this. Check the balance and " +
        "either lower the amount or add money first.",
    };
  }

  // ── Invalid input on the backend's side (couldn't decode JSON
  //    / hex / base58, malformed proposal, etc.) ────────────────
  if (
    hay.includes("invalid pubkey") ||
    hay.includes("invalid base58") ||
    hay.includes("malformed") ||
    hay.includes("bad request")
  ) {
    return {
      title: "Something in the request didn't look right",
      body:
        "Double-check addresses and amounts, then try again. If everything " +
        "looks correct, refresh the page and retry.",
    };
  }

  // ── Proposal lifecycle (approve / decline / send) ─────────────
  if (
    hay.includes("already approved") ||
    hay.includes("already executed") ||
    hay.includes("already cancelled") ||
    hay.includes("expired")
  ) {
    return {
      title: "This request has already been handled",
      body: "Refresh to see the current state of the wallet.",
    };
  }

  // ── Spending rule missing (send / approve when no intent) ─────
  if (
    (context === "send" || context === "approve") &&
    (hay.includes("intent") &&
      (hay.includes("not found") || hay.includes("no intent")))
  ) {
    return {
      title: "This wallet hasn't set up spending yet",
      body: "Set up sending on the wallet first, then come back to send a request.",
    };
  }

  // ── Catch-all: surface the underlying message but with a
  //    context-aware title so it doesn't read as raw stderr. ────
  const fallbackTitle: Record<ActionContext, string> = {
    "create-wallet": "Couldn't create the wallet",
    "add-chain": "Couldn't add that chain",
    "set-up-spending": "Couldn't set up sending",
    send: "Couldn't send the request",
    approve: "Couldn't approve this request",
    decline: "Couldn't decline this request",
    "add-friend": "Couldn't add this friend",
    generic: "Something went wrong",
  };

  // Prefer stderr/stdout when the wrapper message is the generic
  // "clear-msig command failed" — without this the toast is opaque
  // (the real diagnostic from the CLI is sitting in stderr). Cap the
  // surfaced text so we don't flood the toast with a 5KB anyhow chain.
  const wrapperOnly =
    bag.payloadError === "clear-msig command failed" ||
    bag.message === "clear-msig command failed";
  const detail = wrapperOnly
    ? firstNonEmpty(bag.stderr, bag.stdout, bag.payloadError, bag.message)
    : firstNonEmpty(bag.message, bag.payloadError, bag.stderr, bag.stdout);

  return {
    title: fallbackTitle[context],
    body: detail
      ? truncate(detail.trim(), 320)
      : "Try again. If it keeps happening, check the console for details.",
  };
}

function firstNonEmpty(...candidates: string[]): string {
  for (const c of candidates) {
    const t = c?.trim();
    if (t && t !== "clear-msig command failed") return t;
  }
  return "";
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max).trimEnd() + "…";
}

/// Match the haystack against the on-chain WalletError catalogue.
/// Returns a fully-rendered FriendlyError when a known variant fires.
/// Source of truth: programs/clear-wallet/src/error.rs. Keep this
/// table in sync when new variants land.
function walletProgramErrorMessage(hay: string): FriendlyError | null {
  // 1. Anchor logs the variant by name in the simulation output:
  //    `Program log: AnchorError caused by account: ... Error Code:
  //    TooManyActiveProposals.` Hay is already lowercased upstream;
  //    match anchored by `error code:` to avoid false positives like
  //    a wallet name that happens to contain "expired".
  for (const [name, msg] of Object.entries(WALLET_ERRORS)) {
    const needle = name.toLowerCase();
    if (
      hay.includes(`error code: ${needle}`) ||
      hay.includes(`error name: ${needle}`) ||
      hay.includes(`anchorerror caused by`) && hay.includes(needle)
    ) {
      return msg;
    }
  }
  // 2. Anchor also emits the hex code: `custom program error: 0x1782`.
  //    Map back via the offset from the base discriminant (6000).
  const customCode = hay.match(/custom program error:\s*0x([0-9a-f]+)/i);
  if (customCode) {
    const code = parseInt(customCode[1], 16);
    if (code >= 6000 && code <= 6022) {
      const name = WALLET_ERROR_INDEX[code - 6000];
      const msg = WALLET_ERRORS[name];
      if (msg) return msg;
    }
    // System / token errors users see most often.
    if (code === 0x0) {
      return {
        title: "An account already exists with that address",
        body:
          "The wallet or proposal slot you're trying to create is already on chain. " +
          "Pick a different name (for create) or refresh to see the existing record.",
      };
    }
    if (code === 0x1) {
      return {
        title: "Not enough SOL to cover rent and fees",
        body:
          "Solana charges rent for every account it stores. The relayer's " +
          "sponsored-gas keypair needs more devnet SOL. Try the airdrop button or " +
          "ping the operator.",
      };
    }
  }
  return null;
}

/// Pick the most-recent prose-shaped line from the error bag. Trims
/// stack frames, "Caused by:" headers, JSON brackets, and any line
/// that's not actual diagnostic prose so the toast never surfaces a
/// bare `}` or `[` as if it were the error message. When nothing
/// looks prose-shaped, returns null and the caller falls through to
/// a static message.
function pickLastUsefulLine(b: SignalBag): string | null {
  const merged = [b.payloadError, b.message, b.stderr, b.stdout]
    .filter((s) => s && s.trim())
    .join("\n");
  const lines = merged
    .split("\n")
    .map((l) => l.trim())
    .filter(isProseLine);
  // Prefer a line containing the actual diagnostic, otherwise fall
  // back to the last surviving prose line.
  const diag =
    lines.find((l) => l.toLowerCase().includes("rpc response error")) ??
    lines[lines.length - 1];
  if (!diag) return null;
  // Ensure the line ends with terminal punctuation so concatenating
  // " Wait a few seconds..." reads as prose, not as a fragment.
  return /[.!?]$/.test(diag) ? diag : `${diag}.`;
}

function isProseLine(l: string): boolean {
  if (!l) return false;
  if (l.length < 12) return false; // single chars, brackets, short noise
  if (l.startsWith("Caused by")) return false;
  if (/^[0-9]+:/.test(l)) return false; // anyhow chain numbering
  if (l.startsWith("at ")) return false; // stack frame
  // Reject lines that are mostly punctuation / brackets / hex blobs.
  // A prose line has a healthy alpha-character ratio.
  const alpha = (l.match(/[a-zA-Z]/g) ?? []).length;
  if (alpha / l.length < 0.4) return false;
  // Reject pure-JSON-shape lines (open with `{`/`[`, close with `}`/`]`).
  if (/^[{[].*[}\]]$/.test(l) && !/[a-zA-Z]\s/.test(l)) return false;
  return true;
}

/// Map of on-chain `WalletError` variants → friendly copy. Keep in
/// sync with `programs/clear-wallet/src/error.rs`.
const WALLET_ERRORS: Record<string, FriendlyError> = {
  TooManyProposers: {
    title: "Too many proposers on this wallet",
    body: "The on-chain limit is 16 proposers. Drop someone before adding another.",
  },
  TooManyApprovers: {
    title: "Too many approvers on this wallet",
    body: "The on-chain limit is 16 approvers. Drop someone before adding another.",
  },
  InvalidApprovalThreshold: {
    title: "Approval threshold doesn't fit the wallet",
    body: "The number of approvals required must be at least 1 and at most the number of approvers. Adjust and retry.",
  },
  InvalidCancellationThreshold: {
    title: "Cancellation threshold doesn't fit the wallet",
    body: "The number of cancellations required must be at least 1 and at most the number of approvers. Adjust and retry.",
  },
  ProposalNotActive: {
    title: "This request isn't open anymore",
    body: "It was already approved, executed, or cancelled by someone else. Refresh to see the latest state.",
  },
  ProposalNotApproved: {
    title: "This request still needs approvals before it can run",
    body: "Approve it first (and ask any other friends required by the rule to do the same). Once it's Approved, it can execute.",
  },
  ProposalNotFinalized: {
    title: "This request hasn't finished yet",
    body: "Wait for it to execute or be cancelled before cleaning up.",
  },
  Expired: {
    title: "This request has expired",
    body: "Each signed message has an expiry timestamp. Create a new request and try again.",
  },
  TimelockNotElapsed: {
    title: "Still inside the safety timelock",
    body: "This rule has a wait period between approval and execution. Try again once the timer is up.",
  },
  AlreadyApproved: {
    title: "You already approved this request",
    body: "Refresh to see the current state. Another approval would be a no-op.",
  },
  AlreadyCancelled: {
    title: "You already declined this request",
    body: "Refresh to see the current state. Another decline would be a no-op.",
  },
  InvalidMemberIndex: {
    title: "Couldn't match your wallet to a slot in this request",
    body: "Your wallet may have been removed from the approvers list. Refresh and check the members page.",
  },
  InvalidProposalIndex: {
    title: "Another request landed before yours",
    body: "Someone else (or your previous attempt) created a request just before this one. Try again — the new one will use the next slot.",
  },
  InvalidSignature: {
    title: "Signature didn't verify",
    body: "The wallet signed something that doesn't match what the program expected. This is usually a stale request — refresh and try again from a fresh state.",
  },
  NotProposer: {
    title: "Your wallet can't propose from this rule",
    body: "Only members on the proposers list can create requests against this rule. Ask one of them to propose, or have an admin add you.",
  },
  IntentNotApproved: {
    title: "This rule needs more approvals before it can be used",
    body: "Approve the rule's setup first; once it's Approved, sends can flow through it.",
  },
  IntentHasActiveProposals: {
    title: "There's a pending request on this rule",
    body: "Approve or cancel the existing request first, then try again. Look in the wallet's request inbox; the one in 'Active' status is blocking the change.",
  },
  TooManyIntents: {
    title: "This wallet is full",
    body: "The on-chain limit is 256 rules per wallet. Remove an old rule before adding a new one.",
  },
  TooManyActiveProposals: {
    title: "Too many active requests on this rule",
    body: "Resolve some of the existing pending requests (approve, decline, or wait for them to expire) before creating another.",
  },
  TooManyAccounts: {
    title: "This rule references too many accounts",
    body: "The on-chain limit is 32 accounts per rule definition. Simplify the rule or split it into two.",
  },
  AccountCountMismatch: {
    title: "Rule definition is out of sync",
    body: "The accounts the request needs don't match the rule on chain. Refresh the wallet and retry; if it persists, the rule may need to be re-saved.",
  },
  AccountAddressMismatch: {
    title: "An account address didn't match",
    body: "One of the accounts the program expected doesn't match what was passed. This is usually a stale state — refresh and retry.",
  },
  ParamConstraintViolation: {
    title: "A value in this request breaks the rule's constraints",
    body: "The amount, recipient, or another field doesn't satisfy the rule's limits. Adjust and try again.",
  },
};

/// Ordered list of WalletError names by Anchor discriminant offset
/// (variant index from the base 6000). Lookups by hex code map back
/// through this index. Source: programs/clear-wallet/src/error.rs.
const WALLET_ERROR_INDEX: ReadonlyArray<string> = [
  "TooManyProposers",
  "TooManyApprovers",
  "InvalidApprovalThreshold",
  "InvalidCancellationThreshold",
  "ProposalNotActive",
  "ProposalNotApproved",
  "ProposalNotFinalized",
  "Expired",
  "TimelockNotElapsed",
  "AlreadyApproved",
  "AlreadyCancelled",
  "InvalidMemberIndex",
  "InvalidProposalIndex",
  "InvalidSignature",
  "NotProposer",
  "IntentNotApproved",
  "IntentHasActiveProposals",
  "TooManyIntents",
  "TooManyActiveProposals",
  "TooManyAccounts",
  "AccountCountMismatch",
  "AccountAddressMismatch",
  "ParamConstraintViolation",
];
