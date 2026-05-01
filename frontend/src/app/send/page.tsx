"use client";

// Send a request — third beat of the retail story, now real.
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
// yet) — a price feed plugs in here when the network is live.

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Loader2,
  ShieldAlert,
  Star,
  UserPlus,
  Users,
} from "lucide-react";
import { backendApi } from "@/lib/api/endpoints";
import { friendlyError } from "@/lib/api/errors";
import { fromHex, IntentType, toHex } from "@/lib/msig";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import {
  isValidSolanaAddress,
  recentContacts,
  shortAddress,
  type Contact,
} from "@/lib/retail/contacts";
import { useContacts } from "@/lib/hooks/useContacts";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/retail/Button";
import { WalletPopupNarration } from "@/components/retail/WalletPopupNarration";

type Stage = "compose" | "sending" | "sent";
const STAGE_TRANSITION = {
  duration: 0.4,
  ease: [0.22, 1, 0.36, 1] as const,
};

// Cosmetic formatter for the typed SOL amount — locale-grouped with
// up to four decimals (matches Solana's catalog `displayDecimals`).
function formatAmount(raw: string): string {
  const n = parseFloat(raw);
  if (isNaN(n) || n <= 0) return "0";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

// 32 random bytes as a 0x-prefixed hex string. Each proposal needs a
// fresh nonce so the message hash never repeats.
function generateNonceHex(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return "0x" + toHex(bytes);
}

export default function SendPageWrapper() {
  return (
    <Suspense
      fallback={<main className="min-h-screen bg-canvas" aria-hidden="true" />}
    >
      <SendPage />
    </Suspense>
  );
}

function SendPage() {
  const router = useRouter();
  const params = useSearchParams();
  const reduce = useReducedMotion();
  const wallet = useWallet();
  const { connection } = useConnection();
  const { signBytes } = useSignWithWallet();
  const toast = useToast();
  const queryClient = useQueryClient();
  const contacts = useContacts();

  const walletName = params?.get("wallet")?.trim() || "";

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
  // user-facing params — encoding {destination, amount} against them
  // produces empty params_data and the submit then rejects.
  const firstIntent = useMemo(() => {
    if (!intentsQuery.data) return null;
    return (
      intentsQuery.data.find(
        (it) => it.account !== null && it.account.intentType === IntentType.Custom,
      ) ?? null
    );
  }, [intentsQuery.data]);

  // If the wallet doesn't have a spending rule yet, bounce to setup.
  useEffect(() => {
    if (!walletName) return;
    if (intentsQuery.isLoading || walletQuery.isLoading) return;
    if (!walletQuery.data) return;
    if (firstIntent === null) {
      router.replace(
        `/app/wallet/${encodeURIComponent(walletName)}/setup`,
      );
    }
  }, [
    walletName,
    intentsQuery.isLoading,
    walletQuery.isLoading,
    walletQuery.data,
    firstIntent,
    router,
  ]);

  const [stage, setStage] = useState<Stage>("compose");
  const [amount, setAmount] = useState("");
  const [recipientText, setRecipientText] = useState("");
  const [note, setNote] = useState("");
  const [savedNewContact, setSavedNewContact] = useState(false);

  // Resolve the typed recipient: contact-by-name first, raw address
  // as a fallback. Resolution drives both the display state below the
  // input and the address that goes on chain.
  const resolved: ResolvedRecipient = useMemo(() => {
    const trimmed = recipientText.trim();
    if (!trimmed) return { kind: "empty" };
    const byName = contacts.contacts.find(
      (c) => c.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (byName) return { kind: "contact", contact: byName };
    if (isValidSolanaAddress(trimmed)) {
      return { kind: "address", address: trimmed };
    }
    return { kind: "unknown" };
  }, [recipientText, contacts.contacts]);

  const numericAmount = parseFloat(amount);
  const amountValid = !isNaN(numericAmount) && numericAmount > 0;
  const canSubmit =
    amountValid &&
    (resolved.kind === "contact" || resolved.kind === "address") &&
    !!firstIntent;

  const submit = useMutation({
    mutationFn: async () => {
      if (!wallet.publicKey)
        throw new Error("Connect your wallet first");
      if (!firstIntent || !firstIntent.account)
        throw new Error("Spending isn't set up for this wallet");
      const destination =
        resolved.kind === "contact"
          ? resolved.contact.address
          : resolved.kind === "address"
            ? resolved.address
            : null;
      if (!destination)
        throw new Error("Pick a contact or paste an address");

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
      const dry = await backendApi.prepare.createProposal(walletName, {
        intent_index: firstIntent.account.intentIndex,
        params: [
          `destination=${destination}`,
          `amount=${lamports}`,
          `nonce_value=${nonceHex}`,
        ],
        // Tells the CLI which identity to validate against during
        // dry-run; without this it uses its filesystem keypair which
        // isn't in any user's proposers list.
        actor_pubkey: wallet.publicKey.toBase58(),
      });

      // 2. Sign with the user's wallet.
      const signed = await signBytes(fromHex(dry.message_hex));

      // 3. Submit propose: lands the proposal on chain in Active
      //    state with empty bitmap. Propose does not auto-flip the
      //    proposer's approval bit, so without the steps below the
      //    money never moves.
      const submitted = await backendApi.submit.createProposal(walletName, {
        ...signed,
        params_data_hex: dry.params_data_hex,
        expiry: dry.expiry,
        intent_index: firstIntent.account.intentIndex,
      });

      const proposal = (submitted as Record<string, unknown>)?.proposal;
      const me = wallet.publicKey?.toBase58();
      if (typeof proposal !== "string" || proposal.length === 0 || !me) {
        return submitted;
      }

      // 4. If the user is also an approver, flip their bit in the
      //    same flow so a 1-of-1 wallet doesn't get stuck waiting
      //    for "someone" to approve their own request.
      const intent = firstIntent.account;
      const userIsApprover = intent.approvers.includes(me);
      if (userIsApprover) {
        try {
          const approveDry = await backendApi.prepare.approveProposal(
            walletName,
            proposal,
            { actor_pubkey: me },
          );
          const approveSigned = await signBytes(fromHex(approveDry.message_hex));
          await backendApi.submit.approveProposal(walletName, proposal, {
            ...approveSigned,
            expiry: approveDry.expiry,
          });
        } catch (err) {
          // Don't poison the send if the user cancels the approve
          // popup — the proposal is already on chain and they (or
          // their friends) can approve it later from the inbox.
          console.warn("[send] propose ok but approve step failed", err);
          return submitted;
        }
      }

      // 5. If we have enough approvals (threshold met), execute now
      //    so the SOL actually moves. Otherwise the proposal sits
      //    in the inbox waiting for the remaining friends to sign.
      const approvalsAfterUs =
        (userIsApprover ? 1 : 0) /* this proposal had bitmap=0 from propose */;
      if (approvalsAfterUs >= intent.approvalThreshold) {
        try {
          await backendApi.executeProposal(walletName, proposal, {});
        } catch (err) {
          // Same as above — execute is best-effort. The proposal
          // is approved on chain; an explicit retry from the
          // proposal-detail page will land it.
          console.warn("[send] approve ok but execute failed", err);
        }
      }
      return submitted;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["proposals", walletName] });
      queryClient.invalidateQueries({ queryKey: ["my-organizations"] });
      setStage("sent");
    },
    onError: (err) => {
      console.error("[send]", err);
      const fe = friendlyError(err, "send");
      toast.error(fe.title, { details: fe.body });
      setStage("compose");
    },
  });

  const handleSubmit = () => {
    if (!canSubmit) return;
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
        : "";

  return (
    <main className="relative flex min-h-screen flex-col bg-canvas">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -left-32 -top-16 h-[55vh] w-[80vw] max-w-[640px] rounded-full bg-accent/[0.06] blur-3xl" />
      </div>

      <header className="relative z-10 flex items-center justify-between px-gutter pt-6">
        <button
          type="button"
          onClick={() => {
            if (stage === "sent") {
              router.push(
                walletName
                  ? `/app/wallet/${encodeURIComponent(walletName)}`
                  : "/app/wallet",
              );
            } else {
              router.back();
            }
          }}
          className={
            "-ml-2 inline-flex items-center gap-1.5 rounded-soft px-2 py-1 text-sm text-text-soft " +
            "transition-colors duration-base ease-out-soft hover:text-text-strong " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          }
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {stage === "sent" ? "Done" : "Back"}
        </button>
        <span className="rounded-full border border-border-soft bg-surface-raised px-3 py-1 text-xs font-medium text-text-strong">
          {walletName || "your shared wallet"}
        </span>
      </header>

      <div className="relative z-10 flex flex-1 items-center justify-center px-gutter py-10">
        <div className="w-full max-w-md">
          {stage === "compose" && (
            <ComposeStage
              walletName={walletName || "your shared wallet"}
              amount={amount}
              setAmount={setAmount}
              recipientText={recipientText}
              setRecipientText={setRecipientText}
              note={note}
              setNote={setNote}
              resolved={resolved}
              recents={recentContacts(4)}
              hydratedContacts={contacts.hydrated}
              savedNewContact={savedNewContact}
              onSaveNewContact={handleSaveNewContact}
              canSubmit={canSubmit}
              onSubmit={handleSubmit}
              waitingForRule={intentsQuery.isLoading || walletQuery.isLoading}
              reduce={!!reduce}
            />
          )}
          {stage === "sending" && <SendingStage reduce={!!reduce} />}
          {stage === "sent" && (
            <SentStage
              amountDisplay={sentAmountDisplay}
              recipientDisplay={sentRecipientDisplay}
              walletName={walletName || "your shared wallet"}
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
    </main>
  );
}

// ─── Stage 1: compose ──────────────────────────────────────────────

type ResolvedRecipient =
  | { kind: "empty" }
  | { kind: "contact"; contact: Contact }
  | { kind: "address"; address: string }
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
  recents: Contact[];
  hydratedContacts: boolean;
  savedNewContact: boolean;
  onSaveNewContact: (name: string, address: string) => void;
  canSubmit: boolean;
  onSubmit: () => void;
  waitingForRule: boolean;
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
  recents,
  hydratedContacts,
  savedNewContact,
  onSaveNewContact,
  canSubmit,
  onSubmit,
  waitingForRule,
  reduce,
}: ComposeStageProps) {
  const motionProps = reduce
    ? { initial: false as const, animate: { opacity: 1 } }
    : {
        initial: { opacity: 0, y: 16 },
        animate: { opacity: 1, y: 0 },
      };

  const display = useMemo(() => formatAmount(amount), [amount]);

  return (
    <motion.section
      {...motionProps}
      transition={STAGE_TRANSITION}
      className="flex flex-col"
    >
      <p className="text-center text-[11px] font-medium uppercase tracking-[0.18em] text-text-soft">
        Sending from {walletName}
      </p>

      {/* The big number IS the input — typing updates the value
          users see. Type SOL directly; ticker rendered as a quiet
          suffix so the editing area is unambiguous. */}
      <label className="mt-6 flex cursor-text flex-col items-center">
        <span className="sr-only">Amount in SOL</span>
        <div className="flex items-baseline justify-center gap-2">
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^\d.]/g, "");
              // Cap whole part at 12 digits so the input can't grow
              // arbitrarily (and so layout doesn't blow up). 1T SOL
              // is comfortably above any realistic balance.
              const [wholeRaw = "", frac] = raw.split(".");
              const whole = wholeRaw.slice(0, 12);
              // Solana goes to 9 decimals; cap the typed string at 4
              // (catalog's displayDecimals) so users can't type
              // sub-dust amounts that look like noise.
              const next =
                frac === undefined ? whole : `${whole}.${frac.slice(0, 4)}`;
              setAmount(next);
            }}
            placeholder="0"
            autoFocus
            maxLength={20}
            aria-label="Amount in SOL"
            className={
              "bg-transparent font-display text-5xl font-medium text-text-strong " +
              "text-right caret-accent outline-none placeholder:text-text-soft/30"
            }
            style={{ width: `${Math.max(1, amount.length || 1)}ch` }}
          />
          <span
            aria-hidden="true"
            className="font-display text-5xl font-medium text-text-soft/60"
          >
            SOL
          </span>
        </div>
        <p className="mt-2 text-xs text-text-soft">
          {amount ? `${display} SOL` : "Type an amount in SOL"}
        </p>
      </label>

      {/* Recents row — only shows if the user has any saved contacts. */}
      {hydratedContacts && recents.length > 0 && (
        <div className="mt-7">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-text-soft">
            Recent
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {recents.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setRecipientText(c.name)}
                className={
                  "inline-flex items-center gap-1.5 rounded-full border bg-surface-raised px-3 py-1.5 text-sm " +
                  "transition-[border-color,transform,box-shadow] duration-base ease-out-soft " +
                  "hover:-translate-y-0.5 hover:border-accent hover:shadow-card-rest " +
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas " +
                  (recipientText.trim().toLowerCase() === c.name.toLowerCase()
                    ? "border-accent text-accent"
                    : "border-border-soft text-text-strong")
                }
              >
                <Star className="h-3 w-3" aria-hidden="true" />
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3 rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
        <Field
          label="To"
          value={recipientText}
          onChange={setRecipientText}
          placeholder="Sarah, or paste a wallet address"
          autoFocus
          maxLength={64}
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
      </div>

      <div className="mt-6">
        <WalletPopupNarration action="send this request" popups={2} />
      </div>

      <Button
        size="lg"
        fullWidth
        className="mt-3"
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

      <p className="mt-4 text-center text-xs text-text-soft">
        Your friends in {walletName} will be asked to approve before it
        sends.
      </p>

      {/* Batch entry point — same template, N rows. Surfaced here so
          it doesn't compete with the primary single-send CTA but is
          one tap away when a payroll-style send is needed. */}
      <Link
        href={`/send/batch?wallet=${encodeURIComponent(walletName)}`}
        className={
          "mt-4 inline-flex items-center justify-center gap-2 self-center rounded-full border border-border-soft " +
          "bg-surface-raised px-3.5 py-1.5 text-xs font-medium text-text-soft " +
          "transition-[border-color,color,transform] duration-base ease-out-soft " +
          "hover:-translate-y-0.5 hover:border-accent hover:text-accent " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        }
      >
        <Users className="h-3.5 w-3.5" aria-hidden="true" />
        Send to many at once
      </Link>
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
        Type a contact name or paste a Solana wallet address.
      </p>
    );
  }
  if (resolved.kind === "unknown") {
    return (
      <p className="-mt-1 text-xs text-warning">
        That doesn&rsquo;t look like a contact name or a valid wallet
        address.
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
  // Pasted address — warn explicitly and offer to save as a contact.
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
          . Make sure this is correct — money sent to the wrong address
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
                  "flex-1 rounded-soft border border-border-soft bg-surface-raised px-2.5 py-1.5 text-xs text-text-strong " +
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
                  "rounded-soft bg-accent px-3 py-1.5 text-xs font-semibold text-white " +
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
      <span className="w-10 shrink-0 text-xs font-medium uppercase tracking-wide text-text-soft">
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
          "flex-1 bg-transparent py-1.5 text-base text-text-strong outline-none " +
          "placeholder:text-text-soft/60"
        }
      />
    </label>
  );
}

// ─── Stage 2: sending ──────────────────────────────────────────────

function SendingStage({ reduce }: { reduce: boolean }) {
  const motionProps = reduce
    ? { initial: false as const, animate: { opacity: 1 } }
    : { initial: { opacity: 0 }, animate: { opacity: 1 } };
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.2 }}
      className="flex flex-col items-center text-center"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-raised shadow-card-rest">
        <Loader2 className="h-7 w-7 animate-spin text-accent" />
      </div>
      <p className="mt-5 text-base text-text-soft">Creating request…</p>
      <p className="mt-1 text-xs text-text-soft">
        Your wallet may ask you to confirm.
      </p>
    </motion.section>
  );
}

// ─── Stage 3: sent ─────────────────────────────────────────────────

interface SentStageProps {
  amountDisplay: string;
  recipientDisplay: string;
  walletName: string;
  onDone: () => void;
  reduce: boolean;
}

function SentStage({
  amountDisplay,
  recipientDisplay,
  walletName,
  onDone,
  reduce,
}: SentStageProps) {
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
        className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-accent text-white shadow-accent-rest"
      >
        <Check className="h-10 w-10" strokeWidth={2.5} />
      </motion.div>

      <h1 className="font-display text-display-sm leading-[1.05] text-text-strong">
        Request created
      </h1>
      <p className="mt-3 max-w-sm text-base text-text-soft">
        {amountDisplay} SOL to{" "}
        <span className="font-medium text-text-strong">
          {recipientDisplay}
        </span>{" "}
        is waiting on your friends in{" "}
        <span className="font-medium text-text-strong">{walletName}</span>.
      </p>

      <Button size="lg" fullWidth className="mt-8" onClick={onDone}>
        Done
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Button>
    </motion.section>
  );
}
