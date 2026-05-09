"use client";

// Send a request - third beat of the retail story, now real.
//
// Composes a SolTransfer proposal against the wallet's first spending
// rule (intent_index of the first live intent). Recipient resolution
// supports both names from the local contacts book and raw pasted
// addresses, with an explicit warning when an address can't be
// matched to a contact (per the user's spec: "paste address with
// warning, and contacts should be available").
//
// Money UX: the amount input shows dollars, but the on-chain amount
// is lamports. For the preview demo we treat $1 ≈ 1 SOL (no oracle
// yet) - a price feed plugs in here when the network is live.

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection, useWallet } from "@/lib/wallet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  Copy,
  Home,
  List as ListIcon,
  Loader2,
  ShieldAlert,
  UserPlus,
  Users,
} from "lucide-react";
import { backendApi } from "@/lib/api/endpoints";
import { friendlyError } from "@/lib/api/errors";
import {
  IntentType,
  toHex,
  findProposalAddress,
  findVaultAddress,
} from "@/lib/msig";
import { toDisplayName } from "@/lib/retail/walletNames";
import { CLEAR_WALLET_PROGRAM_ID } from "@/lib/chain/client";
import { PublicKey } from "@solana/web3.js";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import {
  isValidSolanaAddress,
  shortAddress,
  type Contact,
} from "@/lib/retail/contacts";
import { useContacts } from "@/lib/hooks/useContacts";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { useToast } from "@/components/ui/Toast";
import { evaluatePolicy, PolicyViolationError } from "@/lib/retail/policyEvaluation";
import { usePolicyEvaluation } from "@/lib/hooks/usePolicyEvaluation";
import { PolicyMatchBanner } from "@/components/security/PolicyMatchBanner";
import { Button } from "@/components/retail/Button";
import { BrandLoader } from "@/components/retail/BrandLoader";
import { WalletPopupNarration } from "@/components/retail/WalletPopupNarration";
import {
  SignPayloadPreview,
  type SignPayloadDetail,
} from "@/components/retail/SignPayloadPreview";
import { NextStepCard } from "@/components/retail/NextStepCard";
import { QuickSendInput } from "@/components/retail/QuickSendInput";
import { txUrl as solanaTxUrl } from "@/lib/explorer";
import { recordAttempt } from "@/lib/retail/txLog";
import { resolveSnsName, looksLikeSnsName } from "@/lib/chain/sns";
import { QrScanButton } from "@/components/retail/QrScanButton";
import { RecentRecipientsChips } from "@/components/retail/RecentRecipientsChips";
import { useWalletBudgetUsage } from "@/lib/hooks/useWalletBudgetUsage";
import { SendChainPicker } from "@/components/retail/SendChainPicker";
import { ChainBadge } from "@/components/retail/ChainBadge";
import { chainByKind } from "@/lib/retail/chains";
import { formatUsd, quotePerWhole } from "@/lib/retail/priceConversion";

type Stage = "compose" | "sending" | "sent";
const STAGE_TRANSITION = {
  duration: 0.4,
  ease: [0.22, 1, 0.36, 1] as const,
};

// Cosmetic formatter for the typed SOL amount - locale-grouped with
// up to four decimals (matches Solana's catalog `displayDecimals`).
function formatAmount(raw: string): string {
  const n = parseFloat(raw);
  if (isNaN(n) || n <= 0) return "0";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

// Lamports (bigint) → SOL string, byte-accurate. Used for wallet
// balance display and for the Max button (which needs to round-trip
// through the amount input). 1 SOL = 1e9 lamports.
function formatLamports(lamports: bigint, displayDecimals = 4): string {
  if (lamports === 0n) return "0";
  const negative = lamports < 0n;
  const abs = negative ? -lamports : lamports;
  const whole = abs / 1_000_000_000n;
  const frac = abs % 1_000_000_000n;
  if (frac === 0n) return `${negative ? "-" : ""}${whole}`;
  let fracStr = frac.toString().padStart(9, "0");
  fracStr = fracStr.replace(/0+$/, "").slice(0, displayDecimals);
  return `${negative ? "-" : ""}${whole}${fracStr ? "." + fracStr : ""}`;
}

// 32 random bytes as a 0x-prefixed hex string. Each proposal needs a
// fresh nonce so the message hash never repeats.
// Tag/read helpers for the "execute failed after propose succeeded"
// case. We mark the thrown error with the proposal address so the
// onError handler can render a "retry from the proposal page" CTA
// without inspecting opaque error strings.
const EXECUTE_FAIL_KEY = "__clearMsigExecuteFailedProposal";

function tagExecuteFailure(err: unknown, proposalPda: string): void {
  if (err && typeof err === "object") {
    (err as Record<string, unknown>)[EXECUTE_FAIL_KEY] = proposalPda;
  }
}

function readExecuteFailureProposal(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const v = (err as Record<string, unknown>)[EXECUTE_FAIL_KEY];
  return typeof v === "string" && v.length > 0 ? v : null;
}

// Strip a Solana wallet-scheme prefix from a scanned QR. Phantom +
// most Solana QR sources emit `solana:<address>?amount=…&memo=…`;
// we keep just the address. Anything we can't parse passes through
// unchanged so users can also scan plain base58.
function parseSolanaRecipientFromQr(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const m = trimmed.match(/^solana:([1-9A-HJ-NP-Za-km-z]{32,44})/);
  if (m) return m[1];
  return trimmed;
}

function generateNonceHex(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return "0x" + toHex(bytes);
}

// Build the SignPayloadPreview detail rows for /send. Stays a pure
// function so it can render the policy impact (per-chain + wallet-
// wide) without dragging hook plumbing into the JSX.
interface SendPreviewArgs {
  walletName: string;
  amount: string;
  amountValid: boolean;
  resolved: ResolvedRecipient;
  pendingUsd: number;
  budgetUsage: ReturnType<typeof useWalletBudgetUsage>;
}

function buildSendPreviewDetails(args: SendPreviewArgs): SignPayloadDetail[] {
  const { walletName, amount, amountValid, resolved, pendingUsd, budgetUsage } = args;
  const details: SignPayloadDetail[] = [
    { label: "From wallet", value: toDisplayName(walletName) || "your wallet" },
    { label: "Chain", value: "Solana" },
  ];
  // Always surface the destination address - even for contact-resolved
  // sends. Without this, an attacker who tampers localStorage to swap
  // a contact's address (XSS, malicious extension, shared device) can
  // trick the user into signing "Send 5 SOL to Sarah" while the bytes
  // route to attacker. Showing the abbreviated address gives the user
  // a chance to spot the mismatch before signing.
  if (
    resolved.kind === "address" ||
    resolved.kind === "contact" ||
    resolved.kind === "sns"
  ) {
    const addr =
      resolved.kind === "contact"
        ? resolved.contact.address
        : resolved.address;
    details.push({
      label: "Recipient address",
      value: shortAddress(addr),
      emphasis: "mono",
    });
    if (resolved.kind === "sns") {
      details.push({ label: "SNS name", value: resolved.name });
    }
  }
  if (amountValid) {
    details.push({
      label: "Amount",
      value: `${formatAmount(amount)} SOL`,
      emphasis: "amount",
    });
  }

  // Policy-impact rows. Only render when the user has set the cap
  // they affect; otherwise the detail row would be noise.
  const sol = budgetUsage.perChain.find((c) => c.ticker === "SOL");
  if (amountValid && sol && sol.cap !== null && pendingUsd > 0) {
    const after = sol.spentUsd + pendingUsd;
    details.push({
      label: "Solana / week",
      value: `${formatUsd(after)} of ${formatUsd(sol.cap)}`,
    });
  }
  const cap = budgetUsage.budget?.weeklyUsd ?? null;
  if (amountValid && cap !== null && cap > 0 && pendingUsd > 0) {
    const after = budgetUsage.spentUsd + pendingUsd;
    details.push({
      label: "Wallet / week",
      value: `${formatUsd(after)} of ${formatUsd(cap)}`,
    });
  }
  return details;
}

function buildSendPreviewWarning(args: {
  resolved: ResolvedRecipient;
  pendingUsd: number;
  budgetUsage: ReturnType<typeof useWalletBudgetUsage>;
}): string | undefined {
  const { resolved, pendingUsd, budgetUsage } = args;

  // Policy breach warnings take priority over recipient warnings;
  // they're more consequential.
  const sol = budgetUsage.perChain.find((c) => c.ticker === "SOL");
  if (sol && sol.cap !== null && sol.spentUsd + pendingUsd > sol.cap) {
    const over = sol.spentUsd + pendingUsd - sol.cap;
    return `This send pushes Solana ${formatUsd(over)} over its ${formatUsd(sol.cap)} weekly cap. Friends still need to approve; the cap is a guide today.`;
  }
  const cap = budgetUsage.budget?.weeklyUsd ?? null;
  if (cap !== null && cap > 0 && budgetUsage.spentUsd + pendingUsd > cap) {
    const over = budgetUsage.spentUsd + pendingUsd - cap;
    return `This send pushes ${budgetUsage.budget ? toDisplayName(budgetUsage.budget.walletName) : "the wallet"} ${formatUsd(over)} over its ${formatUsd(cap)} weekly cap.`;
  }
  if (budgetUsage.velocityHit) {
    return `You have already sent ${budgetUsage.sendsLast24h} times in the last 24 hours, at the per-day limit. This send would go above it.`;
  }

  // Recipient warning - last priority.
  if (resolved.kind === "address") {
    return "You are sending to a raw address (no contact match). Money sent to the wrong address cannot be reversed.";
  }
  return undefined;
}

export default function SendPageWrapper() {
  return (
    <Suspense
      fallback={<div className="min-h-screen" aria-hidden="true" />}
    >
      <SendPage />
    </Suspense>
  );
}

function SendPage() {
  const router = useRouter();
  const params = useSearchParams();
  const route = useParams<{ name: string }>();
  const reduce = useReducedMotion();
  const wallet = useWallet();
  const { connection } = useConnection();
  const { signDescriptor } = useSignWithWallet();
  const toast = useToast();
  const queryClient = useQueryClient();
  const contacts = useContacts();

  // Wallet name comes from the URL segment under /app/wallet/[name]/send.
  // We still read other prefilled fields (recipient/amount/note) from
  // the query string so /app/wallet/[name]/send?recipient=Sarah keeps
  // working from QuickAction inputs and natural-language routes.
  const walletName = useMemo(() => {
    const raw = route?.name ?? "";
    try {
      return decodeURIComponent(raw).trim();
    } catch {
      return raw.trim();
    }
  }, [route?.name]);
  // walletName carries the on-chain creator suffix (see lib/retail/walletNames).
  // Use walletDisplay for any user-visible text; walletName stays for
  // routing, API, and chain reads.
  const walletDisplay = toDisplayName(walletName);

  // Load wallet + intents to resolve which intent_index to bind to.
  const walletQuery = useQuery({
    queryKey: ["wallet", walletName],
    queryFn: () => fetchWalletByName(connection, walletName),
    enabled: walletName.length > 0,
    staleTime: 30_000,
  });
  const intentsQuery = useQuery({
    queryKey: ["wallet-intents", walletQuery.data?.pda.toBase58() ?? null],
    queryFn: async () => {
      if (!walletQuery.data) return [];
      // `wallet.intent_index` is the highest used slot, inclusive.
      const upTo = walletQuery.data.account.intentIndex;
      return listIntents(connection, walletQuery.data.pda, upTo);
    },
    enabled: !!walletQuery.data,
    staleTime: 30_000,
  });

  // First *user-defined* spending rule. Slots 0/1/2 are the program's
  // bootstrap AddIntent / RemoveIntent / UpdateIntent; user intents
  // (intentType = Custom = 3) are added on top by setup-spending.
  // Skipping the bootstrap intents matters because they have no
  // user-facing params - encoding {destination, amount} against them
  // produces empty params_data and the submit then rejects.
  const firstIntent = useMemo(() => {
    if (!intentsQuery.data) return null;
    return (
      intentsQuery.data.find(
        (it) => it.account !== null && it.account.intentType === IntentType.Custom,
      ) ?? null
    );
  }, [intentsQuery.data]);

  // No silent redirect to /setup when the wallet's missing a rule -
  // the page renders an inform-and-choose card below. Auto-redirect
  // was disorienting ("I tapped Send, ended up on Setup with no
  // breadcrumb of why").
  const needsSetup =
    !!walletName &&
    !intentsQuery.isLoading &&
    !walletQuery.isLoading &&
    !!walletQuery.data &&
    firstIntent === null;

  const [stage, setStage] = useState<Stage>("compose");
  // Solana tx signature from a successful execute. Set when the
  // proposal threshold is met inline (auto-approve or sole approver),
  // null when the proposal is created but waits on others. Drives
  // the SentStage copy + explorer link.
  const [executedTxid, setExecutedTxid] = useState<string | null>(null);
  // Substep state inside the "sending" stage. Tells the user which
  // step is in flight so a slow Solana RPC doesn't read as a frozen
  // app. Each step in the mutation pushes to this ref via setPhase.
  const [phase, setPhase] = useState<SendingPhase>("preparing");
  // Initialise amount/recipient/note from URL params so the QuickAction
  // input on /app/wallet/[name] can route here with the form already
  // filled in. Subsequent edits override; we never re-read after mount.
  const initialAmount = params?.get("amount")?.trim() ?? "";
  const initialRecipient = params?.get("recipient")?.trim() ?? "";
  const initialNote = params?.get("note")?.trim() ?? "";
  const [amount, setAmount] = useState(initialAmount);
  const [recipientText, setRecipientText] = useState(initialRecipient);
  const [note, setNote] = useState(initialNote);
  const [savedNewContact, setSavedNewContact] = useState(false);

  // SNS resolution - when the typed text looks like a `.sol` name
  // (or bare label) AND doesn't match a local contact / valid
  // address, query Bonfida's proxy for the on-chain owner. Cached
  // by react-query so re-typing the same name doesn't refetch.
  const trimmedRecipientText = recipientText.trim();
  const localContactMatch = useMemo(
    () =>
      contacts.contacts.find(
        (c) => c.name.toLowerCase() === trimmedRecipientText.toLowerCase(),
      ) ?? null,
    [contacts.contacts, trimmedRecipientText],
  );
  const isAlreadyValidAddress = isValidSolanaAddress(trimmedRecipientText);
  const shouldTrySns =
    !!trimmedRecipientText &&
    !localContactMatch &&
    !isAlreadyValidAddress &&
    looksLikeSnsName(trimmedRecipientText);
  const snsQuery = useQuery({
    queryKey: ["sns-resolve", trimmedRecipientText.toLowerCase()],
    queryFn: () => resolveSnsName(trimmedRecipientText),
    enabled: shouldTrySns,
    staleTime: 60_000,
    retry: 0,
  });

  // Resolve the typed recipient: contact-by-name first, raw address
  // second, SNS lookup last. Resolution drives both the display
  // state below the input and the address that goes on chain.
  const resolved: ResolvedRecipient = useMemo(() => {
    if (!trimmedRecipientText) return { kind: "empty" };
    if (localContactMatch) return { kind: "contact", contact: localContactMatch };
    if (isAlreadyValidAddress) {
      return { kind: "address", address: trimmedRecipientText };
    }
    if (shouldTrySns) {
      if (snsQuery.isLoading || snsQuery.isFetching) {
        return { kind: "resolving", name: trimmedRecipientText };
      }
      if (snsQuery.data) {
        return {
          kind: "sns",
          name: trimmedRecipientText,
          address: snsQuery.data,
        };
      }
    }
    return { kind: "unknown" };
  }, [
    trimmedRecipientText,
    localContactMatch,
    isAlreadyValidAddress,
    shouldTrySns,
    snsQuery.isLoading,
    snsQuery.isFetching,
    snsQuery.data,
  ]);

  const numericAmount = parseFloat(amount);
  const amountValid = !isNaN(numericAmount) && numericAmount > 0;
  const amountLamports = amountValid
    ? BigInt(Math.round(numericAmount * 1_000_000_000))
    : 0n;

  // Live SOL balance of the wallet's vault PDA - that's the account
  // SOL transfers actually come out of (programs/clear-wallet/src/
  // instructions/execute.rs::execute_custom). Vault PDA is
  // findVaultAddress(walletPda).
  //
  // Distinct query key from the dashboard's `["wallet-balance", …]`
  // (which returns `number`); this hook returns `bigint` for byte-
  // accurate amount/reserve comparisons. Sharing the key under
  // react-query would let one consumer's cached number leak into
  // the other's bigint math and crash with "Cannot mix BigInt and
  // other types". One-off duplication of the read is cheaper than
  // the cross-consumer coupling.
  const vaultBalanceQuery = useQuery({
    queryKey: [
      "wallet-vault-balance-lamports",
      walletQuery.data?.pda.toBase58() ?? "",
    ],
    queryFn: async () => {
      if (!walletQuery.data) return 0n;
      const [vault] = findVaultAddress(
        walletQuery.data.pda,
        CLEAR_WALLET_PROGRAM_ID,
      );
      const lamports = await connection.getBalance(vault, "confirmed");
      return BigInt(lamports);
    },
    enabled: !!walletQuery.data,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
  });

  // Reserve for the on-chain Solana fee + minimum rent-exempt balance
  // the vault must keep. ~5000 lamports per signature + buffer for any
  // CPI fees during execute_custom; 10_000 lamports = 0.00001 SOL is a
  // generous floor without making sub-cent sends impossible.
  const SOL_FEE_RESERVE_LAMPORTS = 10_000n;

  const vaultBalance = vaultBalanceQuery.data ?? null;
  const balanceLoaded = vaultBalanceQuery.isFetched && vaultBalance !== null;
  const requiredLamports = amountValid
    ? amountLamports + SOL_FEE_RESERVE_LAMPORTS
    : 0n;
  const insufficientBalance =
    balanceLoaded && amountValid && vaultBalance! < requiredLamports;

  // ── Policy-rule pre-flight tripwire ──────────────────────────
  //
  // Walks the wallet's stored policy rules against this candidate
  // proposal (recipient, amount, ticker). The first matching rule
  // wins per Fordefi convention. A "deny" action blocks submit;
  // "require-*" actions surface a banner above the CTA so the
  // user knows extra friction is coming.
  //
  // Today this is UI-only: a determined member with the CLI can
  // still propose. The tripwire becomes load-bearing once
  // Encrypt's #[encrypt_fn] handlers are in the program and the
  // on-chain code reads policy ciphertexts during ika_sign.
  const policyRecipient = useMemo(() => {
    if (resolved.kind === "contact") return resolved.contact.address;
    if (resolved.kind === "address" || resolved.kind === "sns") {
      return resolved.address;
    }
    return "";
  }, [resolved]);
  const policyEvaluation = usePolicyEvaluation({
    walletName,
    chainKind: 0,
    recipient: policyRecipient,
    ticker: "SOL",
    amountDisplay: amount,
    enabled: amountValid && policyRecipient.length > 0,
  });
  const denied = policyEvaluation?.matched && policyEvaluation.action === "deny";

  const canSubmit =
    amountValid &&
    (resolved.kind === "contact" ||
      resolved.kind === "address" ||
      resolved.kind === "sns") &&
    !!firstIntent &&
    !insufficientBalance &&
    !denied;

  // Cross-chain budget tracker - used to render the "this send fits
  // your $X cap" / "would push you over" hint above the CTA.
  const budgetUsage = useWalletBudgetUsage(walletName);

  const submit = useMutation({
    mutationFn: async () => {
      if (!wallet.publicKey)
        throw new Error("Connect your wallet first");
      if (!firstIntent || !firstIntent.account)
        throw new Error("Spending isn't set up for this wallet");
      // Resolve which of our pubkeys the wallet's approvers list
      // expects. With both Ledger and a Dynamic embedded wallet
      // available, the default Ledger-preferred pubkey may not be in
      // approvers - signing with it lands a signature the on-chain
      // verifier rejects. pickSigner picks the matching pubkey, or
      // null when neither is acceptable.
      const signerPk = wallet.pickSigner(
        firstIntent.account.approvers,
      );
      if (!signerPk) {
        throw new Error(
          "None of your connected wallets is in this wallet's approver list. " +
            "Disconnect the Ledger or sign in with the wallet that originally created this multisig.",
        );
      }
      const destination =
        resolved.kind === "contact"
          ? resolved.contact.address
          : resolved.kind === "address"
            ? resolved.address
            : resolved.kind === "sns"
              ? resolved.address
              : null;
      if (!destination)
        throw new Error("Pick a contact or paste an address");

      // Policy pre-flight. Block before the wallet popup opens so the
      // user never signs a doomed send. Sources of truth: localStorage
      // allowlist + time window + per-friend allowance + wallet-wide
      // budget. Client-side enforcement; see lib/retail/policyEvaluation.ts.
      const policy = evaluatePolicy({
        walletName,
        recipientAddress: destination,
        amountSol: numericAmount,
        ticker: "SOL",
        spentUsdThisWindow: budgetUsage.spentUsd,
        spentUsdByChain: Object.fromEntries(
          budgetUsage.perChain.map((c) => [c.ticker, c.spentUsd]),
        ),
      });
      if (!policy.ok) {
        throw new PolicyViolationError(policy.violations);
      }

      const nonceHex = generateNonceHex();
      // SOL → lamports. Solana's smallest unit, 1 SOL = 1e9 lamports.
      const lamports = Math.round(
        numericAmount * 1_000_000_000,
      ).toString();

      // 1. Prepare the proposal: backend builds the unsigned
      //    transaction and returns the bytes the user has to sign.
      // The CLI's `encode_params` looks each value up by name from the
      // intent's param list, so we send `key=value` pairs (not bare
      // positional values). Names match the SolTransfer template:
      // `examples/intents/solana_transfer.json`.
      setPhase("preparing");
      const dry = await backendApi.prepare.createProposal(walletName, {
        intent_index: firstIntent.account.intentIndex,
        params: [
          `destination=${destination}`,
          `amount=${lamports}`,
          `nonce_value=${nonceHex}`,
        ],
        // Tells the CLI which identity to validate against during
        // dry-run; without this it uses its filesystem keypair which
        // isn't in any user's proposers list. Use the resolved
        // signer pubkey so the CLI checks the right identity (the
        // default `wallet.publicKey` may not be the one we'll sign
        // with, see pickSigner above).
        actor_pubkey: signerPk.toBase58(),
      });

      // 2. Sign with the user's wallet.
      setPhase("signing");
      const signed = await signDescriptor(dry, { preferSigner: signerPk });

      // 3. Submit propose: lands the proposal on chain in Active
      //    state with empty bitmap. Propose does not auto-flip the
      //    proposer's approval bit, so without the steps below the
      //    money never moves.
      //
      // Resilience: if the submit throws AFTER the wallet signed
      // (network blip, RPC stub, backend timeout), the on-chain
      // proposal might still be there. We compute the expected PDA
      // from the descriptor + index and poll Solana directly before
      // surfacing an error. The retry layer in lib/api/retry.ts
      // handles transient hints for us; this handles the case where
      // it gave up but the chain saw the tx.
      setPhase("submitting");
      let submitted: Record<string, unknown> | undefined;
      try {
        submitted = (await backendApi.submit.createProposal(walletName, {
          ...signed,
          params_data_hex: dry.params_data_hex,
          expiry: dry.expiry,
          intent_index: firstIntent.account.intentIndex,
        })) as Record<string, unknown>;
      } catch (err) {
        const recovered = await findProposalIfLanded(
          dry,
          connection,
        );
        if (recovered) {
          submitted = { proposal: recovered };
        } else {
          throw err;
        }
      }

      const proposal = (submitted as Record<string, unknown>)?.proposal;
      const me = signerPk.toBase58();
      if (typeof proposal !== "string" || proposal.length === 0) {
        return submitted;
      }

      // 4. If the user is also an approver, flip their bit - but
      //    only if propose didn't already do it on chain (program
      //    auto-approves proposer when proposer ∈ approvers).
      const intent = firstIntent.account;
      const userIsApprover = intent.approvers.includes(me);
      const decision = await approveIfNeeded(connection, proposal);
      if (userIsApprover && decision.needsApproveSignature) {
        setPhase("approving");
        try {
          const approveDry = await backendApi.prepare.approveProposal(
            walletName,
            proposal,
            { actor_pubkey: me },
          );
          const approveSigned = await signDescriptor(approveDry, {
            preferSigner: signerPk,
          });
          await backendApi.submit.approveProposal(walletName, proposal, {
            ...approveSigned,
            expiry: approveDry.expiry,
          });
        } catch (err) {
          // Don't poison the send if the user cancels the approve
          // popup - the proposal is already on chain and they (or
          // their friends) can approve it later from the inbox.
          console.warn("[send] propose ok but approve step failed", err);
          return submitted;
        }
      }

      // 5. If the proposal has reached threshold (either from the
      //    program's auto-approve or our explicit approve above),
      //    execute now so the SOL actually moves.
      const approvalsAfterUs =
        (userIsApprover ? 1 : 0) /* propose either auto-set or we just set it */;
      if (approvalsAfterUs >= intent.approvalThreshold) {
        setPhase("executing");
        let executed: unknown;
        try {
          executed = await backendApi.executeProposal(walletName, proposal, {});
        } catch (err) {
          // Don't swallow - without this the user sees a "Sent" UX
          // even though the SOL never moved (balance stays the same
          // and they think the dashboard is broken). Re-throw with
          // the proposal address attached so onError can offer a
          // direct "retry from the proposal page" link.
          tagExecuteFailure(err, proposal);
          throw err;
        }
        // Solana sends route through the program's `execute_custom`
        // (chain_kind=0 stays on the local path), so the response
        // shape is { txid, path, status } - not the broadcast
        // wrapper EVM uses. Pull txid out so SentStage can link
        // the user to the actual on-chain transfer.
        const tid = (executed as { txid?: unknown })?.txid;
        if (typeof tid === "string" && tid.length > 0) {
          return { ...submitted, executedTxid: tid };
        }
        // execute returned without a txid - backend reached a code
        // path that didn't broadcast. Same UX risk as the throw
        // above (user sees "Sent" with no on-chain effect), so
        // surface it as a failure with the proposal link.
        const err = new Error(
          "The execute step finished but didn't return a transaction id. The proposal is on chain - open it from the dashboard to retry.",
        );
        tagExecuteFailure(err, proposal);
        throw err;
      }
      // Threshold not met inline (multi-member wallet, threshold > 1).
      // Proposal is on chain Active; other approvers need to act
      // before SOL moves. Mark the result so onSuccess shows
      // "Proposal created" instead of "Sent" - without this, a
      // multi-member proposer would see Sent UX with no balance
      // change because the inline execute step never fires.
      return { ...submitted, executedTxid: null, awaitingApprovers: true };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["proposals", walletName] });
      queryClient.invalidateQueries({ queryKey: ["my-organizations"] });
      // Refresh every place the SOL balance is shown so the
      // post-send compose stage, hero, /chains row, and portfolio
      // panel all reflect the new number. Three distinct query
      // keys live in the codebase for the same vault balance -
      // each consumer that decided it wanted a different return
      // type added its own. Invalidate all of them on success;
      // the staleTime / refetchInterval will hydrate them again.
      queryClient.invalidateQueries({ queryKey: ["wallet-balance"] });
      queryClient.invalidateQueries({
        queryKey: ["wallet-vault-balance-lamports"],
      });
      queryClient.invalidateQueries({ queryKey: ["chain-balance"] });
      queryClient.invalidateQueries({
        queryKey: ["wallet-other-chain-balances"],
      });
      const r = result as
        | {
            executedTxid?: unknown;
            awaitingApprovers?: boolean;
            proposal?: unknown;
          }
        | undefined;
      const tid = r?.executedTxid;
      const txid = typeof tid === "string" ? tid : null;
      const proposalPda =
        typeof r?.proposal === "string" ? r.proposal : null;
      const awaitingApprovers = r?.awaitingApprovers === true;
      setExecutedTxid(txid);
      // Only record the attempt as "success" when SOL actually
      // moved (we have a chain-level txid). For multi-member
      // wallets where the proposal is sitting in Active state
      // waiting on approvers, the SOL has NOT moved - recording
      // it as a successful send was lying about a state we hadn't
      // reached yet.
      if (txid) {
        const recipientFull =
          resolved.kind === "contact"
            ? resolved.contact.address
            : resolved.kind === "address"
              ? resolved.address
              : resolved.kind === "sns"
                ? resolved.address
                : undefined;
        recordAttempt({
          walletName,
          chainKind: 0,
          status: "success",
          amountDisplay: sentAmountDisplay,
          ticker: "SOL",
          recipientShort: sentRecipientDisplay,
          recipientFull,
          txId: txid,
          explorerUrl: solanaTxUrl(txid),
        });
      }
      if (awaitingApprovers && proposalPda) {
        // Land in compose with a clear toast pointing at the
        // proposal so the user knows their SOL hasn't moved and
        // why. Showing the SentStage here would be the same lie
        // we just stopped recording.
        toast.success(
          "Proposal created - waiting on approvers to finish the send",
          {
            details:
              "Your SOL hasn't moved yet. Open the proposal from the dashboard once enough friends have approved.",
          },
        );
        setStage("compose");
        return;
      }
      setStage("sent");
    },
    onError: (err) => {
      console.error("[send]", err);
      const executeFailedProposal = readExecuteFailureProposal(err);
      const fe = friendlyError(err, "send");
      // When the proposal reached chain but the execute step blew
      // up, surface a specific call-to-action: the proposal already
      // exists, so the user can open it and retry without
      // re-signing propose+approve.
      if (executeFailedProposal) {
        toast.error(
          "Send didn't go through - proposal created but didn't execute",
          {
            details:
              fe.body +
              ` Open this proposal in the dashboard to retry executing it.`,
          },
        );
      } else {
        toast.error(fe.title, { details: fe.body });
      }
      const stderr =
        (err as { payload?: { stderr?: string } })?.payload?.stderr ?? undefined;
      recordAttempt({
        walletName,
        chainKind: 0,
        status: "failed",
        amountDisplay: sentAmountDisplay,
        ticker: "SOL",
        recipientShort: sentRecipientDisplay,
        errorBrief: executeFailedProposal
          ? "Proposal created but execute failed"
          : fe.title,
        errorStderr: stderr ? stderr.slice(0, 800) : undefined,
      });
      // Even on failure, the propose step may have succeeded - the
      // proposal account is on chain. Refresh the proposals list so
      // the user can find and retry it from the dashboard.
      queryClient.invalidateQueries({ queryKey: ["proposals", walletName] });
      setStage("compose");
    },
  });

  const handleSubmit = () => {
    if (!canSubmit) return;
    setPhase("preparing");
    setStage("sending");
    submit.mutate();
  };

  const handleSaveNewContact = (name: string, address: string) => {
    try {
      contacts.save({ name, address });
      setSavedNewContact(true);
      // Update the input to the saved name so the resolved-state UI
      // immediately shows the contact match.
      setRecipientText(name);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not save contact",
      );
    }
  };

  const sentAmountDisplay = formatAmount(amount);
  const sentRecipientDisplay =
    resolved.kind === "contact"
      ? resolved.contact.name
      : resolved.kind === "address"
        ? shortAddress(resolved.address)
        : resolved.kind === "sns"
          ? resolved.name
          : "";

  return (
    // Workspace shell (HeaderBar + sidebar + canvas blobs) is supplied
    // by /app/layout.tsx; this page just renders the column. Back
    // navigation lives in the global DashboardHeader.
    //
    // Width: max-w-lg on small screens (form stays a focused single
    // column on phones), max-w-3xl on lg+ so the desktop layout has
    // room for the 2-column Amount + Recipient grid below without
    // feeling cramped between the sidebar and the empty right edge.
    <div className="mx-auto flex w-full max-w-lg flex-col lg:max-w-3xl">
      <div className="flex flex-1 flex-col">
          {needsSetup && (
            <div className="mb-6 rounded-card border border-warning/30 bg-warning/5 p-5 text-center shadow-card-rest">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-warning">
                Set up sending first
              </p>
              <p className="mt-2 text-sm text-text-strong">
                <strong>{walletDisplay}</strong> doesn&rsquo;t have a
                spending rule yet. Enable sending. Once that&rsquo;s
                done, you can come back and send anything you want.
              </p>
              <div className="mt-4 flex justify-center gap-2">
                <Link
                  href={`/app/wallet/${encodeURIComponent(walletName)}/setup`}
                  className={
                    "inline-flex items-center gap-1.5 rounded-soft bg-accent px-3.5 py-2 text-sm font-medium text-text-on-accent shadow-accent-rest " +
                    "transition-[background-color,transform] duration-base ease-out-soft hover:bg-accent-hover active:scale-[0.98]"
                  }
                >
                  Enable sending
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
                <Link
                  href={`/app/wallet/${encodeURIComponent(walletName)}`}
                  className="inline-flex items-center rounded-soft border border-border-soft bg-surface-raised px-3.5 py-2 text-sm font-medium text-text-soft transition-colors duration-base ease-out-soft hover:text-text-strong"
                >
                  Back to {walletDisplay}
                </Link>
              </div>
            </div>
          )}
          {stage === "compose" && (
            <SendChainPicker walletName={walletName} activeKind={0} />
          )}
          {stage === "compose" && policyEvaluation?.matched && (
            <PolicyMatchBanner
              walletName={walletName}
              evaluation={policyEvaluation}
            />
          )}
          {stage === "compose" && (
            <ComposeStage
              walletName={walletDisplay || "your shared wallet"}
              amount={amount}
              setAmount={setAmount}
              recipientText={recipientText}
              setRecipientText={setRecipientText}
              note={note}
              setNote={setNote}
              resolved={resolved}
              savedNewContact={savedNewContact}
              onSaveNewContact={handleSaveNewContact}
              canSubmit={canSubmit}
              onSubmit={handleSubmit}
              waitingForRule={intentsQuery.isLoading || walletQuery.isLoading}
              budgetUsage={budgetUsage}
              contactNames={contacts.contacts.map((c) => c.name)}
              onQuickFill={(parsed) => {
                if (parsed.recipientText) setRecipientText(parsed.recipientText);
                if (parsed.amountSol !== undefined)
                  setAmount(String(parsed.amountSol));
                if (parsed.note !== undefined) setNote(parsed.note);
              }}
              pendingUsd={amountValid ? numericAmount * (quotePerWhole("SOL")?.usdPerWhole ?? 0) : 0}
              vaultBalanceLamports={vaultBalance}
              balanceLoading={vaultBalanceQuery.isLoading}
              insufficientBalance={insufficientBalance}
              feeReserveLamports={SOL_FEE_RESERVE_LAMPORTS}
              reduce={!!reduce}
            />
          )}
          {stage === "sending" && (
            <SendingStage reduce={!!reduce} phase={phase} />
          )}
          {stage === "sent" && (
            <SentStage
              amountDisplay={sentAmountDisplay}
              recipientDisplay={sentRecipientDisplay}
              walletName={walletDisplay || "your shared wallet"}
              executedTxid={executedTxid}
              onDone={() =>
                router.push(
                  walletName
                    ? `/app/wallet/${encodeURIComponent(walletName)}`
                    : "/app/wallet",
                )
              }
              reduce={!!reduce}
            />
          )}
      </div>
    </div>
  );
}

// ─── Stage 1: compose ──────────────────────────────────────────────

type ResolvedRecipient =
  | { kind: "empty" }
  | { kind: "contact"; contact: Contact }
  | { kind: "address"; address: string }
  | { kind: "sns"; name: string; address: string }
  | { kind: "resolving"; name: string }
  | { kind: "unknown" };

interface ComposeStageProps {
  walletName: string;
  amount: string;
  setAmount: (s: string) => void;
  recipientText: string;
  setRecipientText: (s: string) => void;
  note: string;
  setNote: (s: string) => void;
  resolved: ResolvedRecipient;
  savedNewContact: boolean;
  onSaveNewContact: (name: string, address: string) => void;
  canSubmit: boolean;
  onSubmit: () => void;
  waitingForRule: boolean;
  budgetUsage: ReturnType<typeof useWalletBudgetUsage>;
  pendingUsd: number;
  contactNames: string[];
  vaultBalanceLamports: bigint | null;
  balanceLoading: boolean;
  insufficientBalance: boolean;
  feeReserveLamports: bigint;
  onQuickFill: (parsed: {
    recipientText?: string;
    amountSol?: number;
    note?: string;
  }) => void;
  reduce: boolean;
}

function ComposeStage({
  walletName,
  amount,
  setAmount,
  recipientText,
  setRecipientText,
  note,
  setNote,
  resolved,
  savedNewContact,
  onSaveNewContact,
  canSubmit,
  onSubmit,
  waitingForRule,
  budgetUsage,
  pendingUsd,
  contactNames,
  vaultBalanceLamports,
  balanceLoading,
  insufficientBalance,
  feeReserveLamports,
  onQuickFill,
  reduce,
}: ComposeStageProps) {
  const walletDisplay = toDisplayName(walletName);
  const motionProps = reduce
    ? { initial: false as const, animate: { opacity: 1 } }
    : {
        initial: { opacity: 0, y: 16 },
        animate: { opacity: 1, y: 0 },
      };

  const display = useMemo(() => formatAmount(amount), [amount]);
  const amountValid = useMemo(() => {
    const n = parseFloat(amount);
    return !isNaN(n) && n > 0;
  }, [amount]);

  const solMeta = chainByKind(0);

  return (
    <motion.section
      {...motionProps}
      transition={STAGE_TRANSITION}
      className="flex flex-col gap-5"
    >
      {/* Compact left-aligned header. Chain badge sits inline with
          the title so the network identity is unmistakable without
          eating a full hero block. Matches the rest of the redesigned
          app (Home / Activity / Settings / Account). */}
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-3">
          {solMeta ? <ChainBadge chain={solMeta} size="md" /> : null}
          <div className="flex flex-col gap-0.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
              Send · Solana
            </p>
            <h1 className="hidden md:block font-display text-2xl font-semibold leading-tight tracking-tight text-text-strong sm:text-3xl">
              Send SOL
            </h1>
          </div>
        </div>
        <p className="text-xs text-text-soft sm:text-sm">
          From{" "}
          <span className="font-medium text-text-strong">{walletDisplay}</span>
        </p>
      </header>

      {/* Quick-send shortcut - type a sentence, the form fills. */}
      <QuickSendInput contactNames={contactNames} onParsed={onQuickFill} />

      {/* Compose grid - Amount + Recipient sit side-by-side on lg+
          so desktop users see both inputs at once. Stacks single-
          column on smaller screens. `items-start` keeps the cards
          at their natural heights instead of stretching to match. */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">

      {/* Amount card - proper bordered card with a section eyebrow.
          The number stays the most prominent pixel on the page, but
          it now sits inside a clear container instead of floating
          centered. Balance + Max live as a footer row inside the
          same card - they're scoped to the amount, not the page. */}
      <section className="flex flex-col gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
            Amount
          </p>
          {typeof vaultBalanceLamports === "bigint" &&
            vaultBalanceLamports > 0n && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  const max =
                    vaultBalanceLamports > feeReserveLamports
                      ? vaultBalanceLamports - feeReserveLamports
                      : 0n;
                  setAmount(formatLamports(max, 4));
                }}
                className="rounded-full border border-accent/30 bg-accent/[0.08] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent transition-colors duration-base ease-out-soft hover:bg-accent/15"
              >
                Use max
              </button>
            )}
        </div>
        <label htmlFor="send-amount-input" className="sr-only">
          Amount in SOL
        </label>
        <div className="flex items-baseline gap-3 border-b border-border-soft pb-3">
          <input
            id="send-amount-input"
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^\d.]/g, "");
              const [wholeRaw = "", frac] = raw.split(".");
              const whole = wholeRaw.slice(0, 12);
              const next =
                frac === undefined ? whole : `${whole}.${frac.slice(0, 4)}`;
              setAmount(next);
            }}
            placeholder="0"
            autoFocus
            maxLength={20}
            aria-label="Amount in SOL"
            className="min-w-0 flex-1 bg-transparent font-numerals text-3xl font-semibold tracking-tight text-text-strong caret-accent tabular-nums outline-none placeholder:text-text-soft/50 sm:text-4xl"
          />
          <span
            aria-hidden="true"
            className="font-display text-base font-semibold uppercase tracking-[0.18em] text-text-soft sm:text-lg"
          >
            SOL
          </span>
        </div>
        <p className="text-xs text-text-soft">
          <span>Wallet has </span>
          <span className="font-numerals font-medium text-text-strong tabular-nums">
            {balanceLoading
              ? "…"
              : typeof vaultBalanceLamports === "bigint"
                ? formatLamports(vaultBalanceLamports)
                : "-"}
          </span>
          <span> SOL</span>
          {amount && (
            <>
              <span aria-hidden="true" className="mx-1.5">
                ·
              </span>
              <span>{display} SOL to send</span>
            </>
          )}
        </p>
        {insufficientBalance &&
          typeof vaultBalanceLamports === "bigint" && (
            <p className="rounded-soft border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-text-strong">
              <span className="font-medium">Insufficient balance.</span>{" "}
              {walletDisplay} has {formatLamports(vaultBalanceLamports)} SOL -
              need at least the amount plus a small reserve for the
              on-chain fee. Top up from Receive or a faucet.
            </p>
          )}
      </section>

      {/* Recipient + Note card */}
      <section className="flex flex-col gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field
              label="To"
              value={recipientText}
              onChange={setRecipientText}
              placeholder="Sarah, or paste a wallet address"
              maxLength={64}
            />
          </div>
          <QrScanButton
            ariaLabel="Scan recipient QR"
            title="Scan a recipient QR"
            onResult={(v) => setRecipientText(parseSolanaRecipientFromQr(v))}
          />
        </div>

        {/* Recents - Cash-App-style stacked list of recent recipients
            on this wallet+chain. The component subscribes to txLog
            updates and self-hides when empty. */}
        <RecentRecipientsChips
          walletName={walletName}
          chainKind={0}
          onPick={setRecipientText}
        />

        <RecipientStatus
          resolved={resolved}
          savedNewContact={savedNewContact}
          onSaveContact={onSaveNewContact}
        />

        <div className="h-px bg-border-soft" />
        <Field
          label="Note"
          value={note}
          onChange={setNote}
          placeholder="What's it for? (optional)"
          optional
          maxLength={140}
        />
      </section>

      </div>{/* end Amount + Recipient grid */}

      <BudgetHint
        budgetUsage={budgetUsage}
        pendingUsd={pendingUsd}
        walletName={walletName}
      />

      {/* Preview + popup narration. Lives just above the CTA so the
          user reads the action they're about to authorize before
          they click Send. */}
      <div className="flex flex-col gap-3">
        <SignPayloadPreview
          action={
            amountValid &&
            (resolved.kind === "contact" ||
              resolved.kind === "address" ||
              resolved.kind === "sns")
              ? `Send ${formatAmount(amount)} SOL to ${
                  resolved.kind === "contact"
                    ? resolved.contact.name
                    : resolved.kind === "sns"
                      ? resolved.name
                      : shortAddress(resolved.address)
                }`
              : "Fill in the amount and recipient above"
          }
          details={buildSendPreviewDetails({
            walletName,
            amount,
            amountValid,
            resolved,
            pendingUsd,
            budgetUsage,
          })}
          warning={buildSendPreviewWarning({
            resolved,
            pendingUsd,
            budgetUsage,
          })}
        />
        <WalletPopupNarration action="send this request" />
      </div>

      {/* Action footer - primary Send CTA + secondary "Send to many"
          link. Sticky on mobile (bottom of viewport, clears safe
          area + BottomNav); inline on sm+ where the page scrolls
          inside the workspace shell. */}
      <div className="flex flex-col gap-3 pt-1">
        <p className="text-xs text-text-soft">
          Friends in {walletDisplay} will be asked to approve before it sends.
        </p>
        <div
          className={
            "-mx-3 sm:mx-0 px-3 sm:px-0 " +
            "sticky bottom-[calc(env(safe-area-inset-bottom,0px)+4rem)] z-20 sm:static sm:bottom-auto " +
            "border-t border-border-soft bg-canvas pt-3 sm:border-0 sm:bg-transparent sm:pt-0"
          }
        >
          <Button
            size="lg"
            fullWidth
            disabled={!canSubmit || waitingForRule}
            onClick={onSubmit}
          >
            {waitingForRule ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading wallet…
              </>
            ) : (
              <>
                Send request
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </>
            )}
          </Button>
        </div>
        <Link
          href={`/app/wallet/${encodeURIComponent(walletName)}/send/batch`}
          className={
            "inline-flex min-h-tap items-center justify-center gap-2 self-center rounded-full border border-border-soft " +
            "bg-canvas px-4 py-2 text-xs font-medium text-text-soft " +
            "transition-colors duration-base ease-out-soft hover:text-accent " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          }
        >
          <Users className="h-3.5 w-3.5" aria-hidden="true" />
          Send to many at once
        </Link>
      </div>
    </motion.section>
  );
}


// ─── Recipient status row ──────────────────────────────────────────

function RecipientStatus({
  resolved,
  savedNewContact,
  onSaveContact,
}: {
  resolved: ResolvedRecipient;
  savedNewContact: boolean;
  onSaveContact: (name: string, address: string) => void;
}) {
  if (resolved.kind === "empty") {
    return (
      <p className="-mt-1 text-xs text-text-soft">
        Type a contact name, a .sol domain, or paste a Solana wallet
        address.
      </p>
    );
  }
  if (resolved.kind === "resolving") {
    return (
      <p className="-mt-1 inline-flex items-center gap-1.5 text-xs text-text-soft">
        Resolving {resolved.name}…
      </p>
    );
  }
  if (resolved.kind === "unknown") {
    return (
      <p className="-mt-1 text-xs text-warning">
        That doesn&rsquo;t look like a contact name, a .sol domain,
        or a valid wallet address.
      </p>
    );
  }
  if (resolved.kind === "contact") {
    return (
      <p className="-mt-1 inline-flex items-center gap-1.5 text-xs text-accent">
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
        Sending to {resolved.contact.name} ·{" "}
        <span className="font-mono text-text-soft">
          {shortAddress(resolved.contact.address)}
        </span>
      </p>
    );
  }
  if (resolved.kind === "sns") {
    return (
      <p className="-mt-1 inline-flex items-center gap-1.5 text-xs text-accent">
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
        Resolved {resolved.name} ·{" "}
        <span className="font-mono text-text-soft">
          {shortAddress(resolved.address)}
        </span>
      </p>
    );
  }
  // Pasted address - warn explicitly and offer to save as a contact.
  return (
    <PastedAddressNotice
      address={resolved.address}
      savedNewContact={savedNewContact}
      onSaveContact={onSaveContact}
    />
  );
}

function PastedAddressNotice({
  address,
  savedNewContact,
  onSaveContact,
}: {
  address: string;
  savedNewContact: boolean;
  onSaveContact: (name: string, address: string) => void;
}) {
  const [showSave, setShowSave] = useState(false);
  const [name, setName] = useState("");

  return (
    <div className="-mt-1 flex flex-col gap-2 rounded-soft border border-warning/30 bg-warning/5 p-3">
      <p className="inline-flex items-start gap-1.5 text-xs text-text-strong">
        <ShieldAlert
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning"
          aria-hidden="true"
        />
        <span>
          New address.{" "}
          <span className="font-mono text-text-soft">
            {shortAddress(address)}
          </span>
          . Make sure this is correct. Money sent to the wrong address
          can&rsquo;t be reversed.
        </span>
      </p>
      {!savedNewContact && (
        <div>
          {!showSave ? (
            <button
              type="button"
              onClick={() => setShowSave(true)}
              className="inline-flex items-center gap-1 text-xs font-medium text-accent transition-colors duration-base ease-out-soft hover:text-accent-hover"
            >
              <UserPlus className="h-3 w-3" aria-hidden="true" />
              Save as contact
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name (e.g. Sarah)"
                autoFocus
                maxLength={40}
                className={
                  // min-h-tap so the input is comfortable to tap on
                  // mobile. Was py-1.5 (~24px) which the parity audit
                  // flagged as below HIG.
                  "flex-1 rounded-soft border border-border-soft bg-surface-raised px-3 py-2 text-xs text-text-strong min-h-tap " +
                  "outline-none placeholder:text-text-soft/60 " +
                  "focus:border-accent"
                }
              />
              <button
                type="button"
                disabled={name.trim().length < 2}
                onClick={() => {
                  onSaveContact(name.trim(), address);
                  setShowSave(false);
                  setName("");
                }}
                className={
                  "inline-flex min-h-tap items-center justify-center rounded-soft bg-accent px-4 py-2 text-xs font-semibold text-text-on-accent " +
                  "transition-colors duration-base ease-out-soft hover:bg-accent-hover " +
                  "disabled:cursor-not-allowed disabled:opacity-40"
                }
              >
                Save
              </button>
            </div>
          )}
        </div>
      )}
      {savedNewContact && (
        <p className="inline-flex items-center gap-1.5 text-xs text-accent">
          <Check className="h-3 w-3" strokeWidth={3} />
          Saved to contacts
        </p>
      )}
    </div>
  );
}

// ─── Field row (used for To + Note) ─────────────────────────────────

interface FieldProps {
  label: string;
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
  optional?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  optional,
  autoFocus,
  maxLength,
}: FieldProps) {
  return (
    <label className="flex items-center gap-3">
      <span className="inline-flex min-w-[64px] shrink-0 items-baseline whitespace-nowrap text-xs font-medium uppercase tracking-wide text-text-soft">
        {label}
        {optional && (
          <span className="ml-1 normal-case tracking-normal text-text-soft/60">
            (opt)
          </span>
        )}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        maxLength={maxLength}
        spellCheck={false}
        className={
          "min-w-0 flex-1 bg-transparent py-1.5 text-base text-text-strong outline-none " +
          "placeholder:text-text-soft/60"
        }
      />
    </label>
  );
}

// ─── Stage 2: sending ──────────────────────────────────────────────

/// Substep within the "sending" stage. Each value maps to a status
/// line in <SendingStage>; the mutation in handleSubmit pushes to it
/// at each step so the user sees progress instead of a frozen spinner
/// during slow Solana RPC round-trips.
type SendingPhase =
  | "preparing"
  | "signing"
  | "submitting"
  | "approving"
  | "executing";

const PHASE_LABEL: Record<SendingPhase, { primary: string; hint: string }> = {
  preparing: {
    primary: "Building your request",
    hint: "Pulling the latest wallet state from Solana.",
  },
  signing: {
    primary: "Waiting for your signature",
    hint: "Approve the message in your wallet or on your Ledger.",
  },
  submitting: {
    primary: "Sending to Solana",
    hint: "This usually takes 2-5 seconds.",
  },
  approving: {
    primary: "Approving the request",
    hint: "Approve the second prompt in your wallet to flip your bit.",
  },
  executing: {
    primary: "Releasing the funds",
    hint: "Threshold met. Asking the chain to execute.",
  },
};

function SendingStage({
  reduce,
  phase,
}: {
  reduce: boolean;
  phase: SendingPhase;
}) {
  const motionProps = reduce
    ? { initial: false as const, animate: { opacity: 1 } }
    : { initial: { opacity: 0 }, animate: { opacity: 1 } };
  const { primary, hint } = PHASE_LABEL[phase];
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.2 }}
      className="flex flex-col items-center text-center"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-raised shadow-card-rest">
        <BrandLoader size={32} label={primary} />
      </div>
      <p className="mt-5 text-base text-text-strong">{primary}…</p>
      <p className="mt-1 text-xs text-text-soft">{hint}</p>
    </motion.section>
  );
}

/// After a submit throws, see if the proposal is on chain anyway.
/// The descriptor binds the signed payload to a fixed (intent_pubkey,
/// proposal_index), so we can compute the expected PDA and ask the
/// RPC directly. Returns the proposal pubkey when the account exists,
/// null otherwise. Polls a few times because RPCs lag.
async function findProposalIfLanded(
  descriptor: { intent_pubkey: string; proposal_index?: number },
  connection: import("@solana/web3.js").Connection,
): Promise<string | null> {
  if (descriptor.proposal_index === undefined || descriptor.proposal_index === null) {
    return null;
  }
  let intentPk: PublicKey;
  try {
    intentPk = new PublicKey(descriptor.intent_pubkey);
  } catch {
    return null;
  }
  const [pda] = findProposalAddress(
    intentPk,
    BigInt(descriptor.proposal_index),
    CLEAR_WALLET_PROGRAM_ID,
  );
  // Poll for ~3 seconds - RPC propagation lag is usually under a
  // second, but devnet's public RPC has been observed at 2s+.
  for (let i = 0; i < 4; i++) {
    try {
      const info = await connection.getAccountInfo(pda, "confirmed");
      if (info) return pda.toBase58();
    } catch {
      // ignore - try again
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  return null;
}

// ─── Stage 3: sent ─────────────────────────────────────────────────

interface SentStageProps {
  amountDisplay: string;
  recipientDisplay: string;
  walletName: string;
  /// Solana tx signature when the proposal was executed inline
  /// (auto-approve or sole-approver path). When null, the proposal
  /// is on chain awaiting other signers - the copy reflects that
  /// distinction so users don't think their friends already moved
  /// money when they didn't.
  executedTxid: string | null;
  onDone: () => void;
  reduce: boolean;
}

function SentStage({
  amountDisplay,
  recipientDisplay,
  walletName,
  executedTxid,
  onDone,
  reduce,
}: SentStageProps) {
  const walletDisplay = toDisplayName(walletName);
  const motionProps = reduce
    ? { initial: false as const, animate: { opacity: 1 } }
    : {
        initial: { opacity: 0, y: 16 },
        animate: { opacity: 1, y: 0 },
      };
  return (
    <motion.section
      {...motionProps}
      transition={STAGE_TRANSITION}
      className="flex flex-col items-center text-center"
    >
      <motion.div
        initial={reduce ? false : { scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{
          type: "spring",
          damping: 18,
          stiffness: 240,
          delay: 0.05,
        }}
        className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-accent text-text-on-accent shadow-accent-rest"
      >
        <Check className="h-10 w-10" strokeWidth={2.5} />
      </motion.div>

      <h1 className="hidden md:block font-display text-display-sm leading-[1.05] text-text-strong">
        {executedTxid ? "Sent" : "Request created"}
      </h1>
      <p className="mt-3 max-w-sm text-base text-text-soft">
        {executedTxid ? (
          <>
            {amountDisplay} SOL on the way to{" "}
            <span className="font-medium text-text-strong">
              {recipientDisplay}
            </span>
            . Confirmed on Solana.
          </>
        ) : (
          <>
            {amountDisplay} SOL to{" "}
            <span className="font-medium text-text-strong">
              {recipientDisplay}
            </span>{" "}
            is waiting on your friends in{" "}
            <span className="font-medium text-text-strong">
              {walletDisplay}
            </span>
            .
          </>
        )}
      </p>

      {executedTxid && (
        <a
          href={solanaTxUrl(executedTxid)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 rounded-pill border border-border-soft bg-surface-raised px-4 py-2 text-xs font-medium text-text-strong transition hover:text-accent"
        >
          View on Solana Explorer
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      )}

      <div className="mt-8 w-full">
        <NextStepCard
          title={`Anything else from ${walletDisplay}?`}
          options={[
            {
              label: "Send another request",
              hint: "Same wallet, different recipient.",
              href: `/app/wallet/${encodeURIComponent(walletName)}/send`,
              primary: true,
              icon: ArrowRight,
            },
            {
              label: "View activity",
              hint: "See approvals coming in.",
              href: `/app/wallet/${encodeURIComponent(walletName)}`,
              icon: ListIcon,
            },
            {
              label: "Back to home",
              href: "/app/wallet",
              icon: Home,
            },
          ]}
        />
      </div>

      <button
        type="button"
        onClick={onDone}
        className="mt-4 text-xs text-text-soft transition-colors duration-base ease-out-soft hover:text-text-strong"
      >
        Or, dismiss this and stay here
      </button>
    </motion.section>
  );
}

// ─── Budget hint (cross-chain spending limit nudge) ────────────────
//
// Sits above the wallet-popup narration on /send. Three states:
//   1. No budget set - silent (don't pile a CTA on top of the
//      send flow's existing surface area).
//   2. Send fits - green "fits within $X left this week".
//   3. Send overshoots - warning "would push {wallet} $X over its
//      weekly cap. Friends still need to approve, this is a heads-up".
//
// Today's a heads-up; the wallet's approval rule still gates every
// send. When the program enforces the cap on chain, the warning
// becomes a hard stop and this component grows a "request override"
// button instead of just narrating.

function BudgetHint({
  budgetUsage,
  pendingUsd,
  walletName,
}: {
  budgetUsage: ReturnType<typeof useWalletBudgetUsage>;
  pendingUsd: number;
  walletName: string;
}) {
  const walletDisplay = toDisplayName(walletName);
  const cap = budgetUsage.budget?.weeklyUsd ?? null;
  if (cap === null || cap === undefined) return null;
  if (pendingUsd <= 0) return null;

  const remaining = cap - budgetUsage.spentUsd;
  const wouldExceed = pendingUsd > remaining;
  if (!wouldExceed) {
    return (
      <p className="mt-4 text-center text-xs text-text-soft">
        ✓ Fits within {formatUsd(remaining)} left in {walletDisplay}&rsquo;s
        weekly cap.
      </p>
    );
  }
  const overage = pendingUsd - Math.max(0, remaining);
  return (
    <div className="mt-4 rounded-card border border-warning/30 bg-warning/5 p-3 text-left text-xs text-text-soft">
      <p className="font-medium text-text-strong">
        Heads up: this send would push {walletDisplay} {formatUsd(overage)}{" "}
        over its weekly cap.
      </p>
      <p className="mt-1 leading-snug">
        Friends still need to approve. The cap is a guide today, not a
        hard stop. Lower the amount or update the cap on{" "}
        <Link
          href={`/app/wallet/${encodeURIComponent(walletName)}/budget`}
          className="text-accent underline-offset-2 hover:underline"
        >
          {walletDisplay}&rsquo;s budget page
        </Link>
        .
      </p>
    </div>
  );
}
