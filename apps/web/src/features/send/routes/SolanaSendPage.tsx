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
import dynamic from "next/dynamic";
import { useParams, useSearchParams } from "next/navigation";
import { useConnection, useWallet } from "@/lib/wallet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { friendlyError } from "@/lib/api/errors";
import { IntentType, findVaultAddress } from "@/lib/msig";
import { toDisplayName } from "@/lib/retail/walletNames";
import { CLEAR_WALLET_PROGRAM_ID } from "@/lib/chain/client";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import {
  isValidSolanaAddress,
  shortAddress,
} from "@/lib/retail/contacts";
import { useContacts } from "@/lib/hooks/useContacts";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { useToast } from "@/components/ui/Toast";
import { usePolicyEvaluation } from "@/lib/hooks/usePolicyEvaluation";
import { RouteSkeleton } from "@/components/retail/RouteSkeleton";
import { txUrl as solanaTxUrl } from "@/lib/explorer";
import { recordAttempt } from "@/lib/retail/txLog";
import { resolveSnsName, looksLikeSnsName } from "@/lib/chain/sns";
import { useWalletBudgetUsage } from "@/lib/hooks/useWalletBudgetUsage";
import { SendChainPicker } from "@/components/retail/SendChainPicker";
import { quotePerWhole } from "@/lib/retail/priceConversion";
import {
  formatAmount,
  readExecuteFailureProposal,
  type ResolvedSolanaRecipient,
} from "@/features/send/domain/solanaSend";
import {
  SOLANA_SEND_PHASE_LABEL,
  type SolanaSendingPhase,
} from "@/features/send/domain/solanaSendProgress";
import { executeSolanaSend } from "@/features/send/infrastructure/executeSolanaSend";

type ResolvedRecipient = ResolvedSolanaRecipient;

type Stage = "compose" | "sending" | "sent";

const PolicyMatchBanner = dynamic(
  () =>
    import("@/components/security/PolicyMatchBanner").then(
      (module) => module.PolicyMatchBanner,
    ),
  { ssr: false, loading: () => null },
);

const ComposeStage = dynamic(
  () =>
    import("@/features/send/ui/solana/SolanaComposeStage").then(
      (module) => module.ComposeStage,
    ),
  { ssr: false, loading: () => <RouteSkeleton variant="form" /> },
);

const SendProgressStage = dynamic(
  () =>
    import("@/features/send/ui/SendProgressStage").then(
      (module) => module.SendProgressStage,
    ),
  { ssr: false, loading: () => null },
);

const SentStage = dynamic(
  () =>
    import("@/features/send/ui/solana/SolanaSendCompletion").then(
      (module) => module.SentStage,
    ),
  { ssr: false, loading: () => <RouteSkeleton variant="detail" /> },
);

export default function SendPageWrapper() {
  return (
    <Suspense fallback={<RouteSkeleton variant="form" />}>
      <SendPage />
    </Suspense>
  );
}

function SendPage() {
  const params = useSearchParams();
  const route = useParams<{ name: string }>();
  const reduce = usePrefersReducedMotion();
  const wallet = useWallet();
  const { connection } = useConnection();
  const { signTypedDescriptor } = useSignWithWallet();
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
        (it) =>
          it.account !== null &&
          it.account.intentType === IntentType.Custom &&
          it.account.chainKind === 0 &&
          it.account.approved,
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
  const [phase, setPhase] = useState<SolanaSendingPhase>("preparing");
  // Initialise amount/recipient/note from URL params so the QuickAction
  // input on /app/wallet/[name] can route here with the form already
  // filled in. Subsequent edits override; we never re-read after mount.
  const initialAmount = params?.get("amount")?.trim() ?? "";
  const initialRecipient = params?.get("recipient")?.trim() ?? "";
  const initialNote = params?.get("note")?.trim() ?? "";
  const selectedAsset = params?.get("asset") ?? null;
  const showSolanaForm =
    selectedAsset === "solana" ||
    !!initialAmount ||
    !!initialRecipient ||
    !!initialNote;
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
  // The immediate banner is a pre-flight affordance. Typed execution
  // independently verifies the signed policy bytes on chain.
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
  const signerBlocked = wallet.signerIssue !== null;

  const canSubmit =
    amountValid &&
    (resolved.kind === "contact" ||
      resolved.kind === "address" ||
      resolved.kind === "sns") &&
    !!firstIntent &&
    !insufficientBalance &&
    !denied &&
    !signerBlocked;

  // Cross-chain budget tracker - used to render the "this send fits
  // your $X cap" / "would push you over" hint above the CTA.
  const budgetUsage = useWalletBudgetUsage(walletName);

  const submit = useMutation({
    mutationFn: () =>
      executeSolanaSend({
        wallet,
        connection,
        signTypedDescriptor,
        firstIntent,
        walletPda: walletQuery.data?.pda ?? null,
        walletName,
        amount,
        numericAmount,
        note,
        resolved,
        budgetUsage,
        setPhase,
      }),
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
          "Request created - waiting for approvals",
          {
            details:
              "Your SOL hasn't moved yet. Open the request from the dashboard once enough people have approved.",
          },
        );
        setStage("compose");
        return;
      }
      setStage("sent");
    },
    onError: (err) => {
      console.error("[send]", err);
      const backendPayload = (err as {
        payload?: {
          code?: number;
          error?: string;
          kind?: string;
          request_id?: string;
          stderr?: string;
          stdout?: string;
        };
        requestId?: string;
      })?.payload;
      if (backendPayload) {
        console.error("[send backend]", {
          requestId: (err as { requestId?: string })?.requestId,
          code: backendPayload.code,
          kind: backendPayload.kind,
          error: backendPayload.error,
          stderr: backendPayload.stderr,
          stdout: backendPayload.stdout,
        });
      }
      const executeFailedProposal = readExecuteFailureProposal(err);
      const fe = friendlyError(err, "send");
      // When the proposal reached chain but the execute step blew
      // up, surface a specific call-to-action: the proposal already
      // exists, so the user can open it and retry without
      // re-signing propose+approve.
      if (executeFailedProposal) {
        toast.error(
          "Request created, but the send did not finish",
          {
            details: [fe.body, "Open this request in the dashboard to retry it."]
              .filter(Boolean)
              .join(" "),
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
          ? "Request created but send did not finish"
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
          {needsSetup && showSolanaForm && (
            <div className="mb-4 rounded-card border border-warning/30 bg-warning/5 p-4 text-center shadow-card-rest">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-warning">
                Turn on sending
              </p>
              <p className="mt-2 text-sm text-text-strong">
                Finish setup for <strong>{walletDisplay}</strong> to send from this wallet.
              </p>
              <div className="mt-4 flex justify-center">
                <Link
                  href={`/app/wallet/${encodeURIComponent(walletName)}/setup`}
                  className={
                    "inline-flex items-center gap-1.5 rounded-soft bg-accent px-3.5 py-2 text-sm font-medium text-text-on-accent shadow-accent-rest " +
                    "transition-[background-color,transform] duration-base ease-out-soft hover:bg-accent-hover active:scale-[0.98]"
                  }
                >
                  Turn on sending
                  <span aria-hidden="true">-&gt;</span>
                </Link>
              </div>
            </div>
          )}
          {stage === "compose" && (
            <SendChainPicker
              walletName={walletName}
              activeKind={showSolanaForm ? 0 : null}
            />
          )}
          {stage === "compose" && policyEvaluation?.matched && (
            <PolicyMatchBanner
              walletName={walletName}
              evaluation={policyEvaluation}
            />
          )}
          {stage === "compose" && showSolanaForm && (
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
              signerBlocked={signerBlocked}
              feeReserveLamports={SOL_FEE_RESERVE_LAMPORTS}
              approvalThreshold={firstIntent?.account?.approvalThreshold ?? 1}
              timelockSeconds={firstIntent?.account?.timelockSeconds ?? 0}
            />
          )}
          {stage === "sending" && (
            <SendProgressStage
              primary={`${SOLANA_SEND_PHASE_LABEL[phase].primary}...`}
              hint={SOLANA_SEND_PHASE_LABEL[phase].hint}
              loaderLabel={SOLANA_SEND_PHASE_LABEL[phase].primary}
              reduceMotion={!!reduce}
            />
          )}
          {stage === "sent" && (
            <SentStage
              amountDisplay={sentAmountDisplay}
              recipientDisplay={sentRecipientDisplay}
              walletName={walletName}
              walletDisplay={walletDisplay || "your shared wallet"}
              executedTxid={executedTxid}
              reduce={!!reduce}
            />
          )}
      </div>
    </div>
  );
}

// ─── Stage 1: compose ──────────────────────────────────────────────

function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduce(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return reduce;
}



// ─── Stage 2: sending ──────────────────────────────────────────────
