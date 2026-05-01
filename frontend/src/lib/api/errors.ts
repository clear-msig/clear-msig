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
}

function bagFromError(err: unknown): SignalBag {
  let message = "";
  let payloadError = "";
  let stderr = "";
  let stdout = "";
  let retryAfterSecs: number | undefined;
  let isNetwork = false;
  let isWalletReject = false;

  if (err instanceof BackendApiError) {
    message = err.message ?? "";
    payloadError = err.payload?.error ?? "";
    stderr = err.payload?.stderr ?? "";
    stdout = err.payload?.stdout ?? "";
    retryAfterSecs = err.payload?.retry_after_secs;
  } else if (err instanceof WalletSignError) {
    message = err.message ?? "";
    isWalletReject = err.code === "rejected";
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

  // ── Wallet UX: user cancelled the signature ───────────────────
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
        "Look in the wallet's request inbox — the one in 'Active' status " +
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
  if (
    context === "create-wallet" &&
    (hay.includes("already exists") ||
      hay.includes("alreadyinitialized") ||
      hay.includes("account already in use"))
  ) {
    return {
      title: "A wallet with that name already exists",
      body: "Pick a different name and try again — names have to be unique on chain.",
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
      body: "Members are unique by address — you can't add the same address twice.",
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
