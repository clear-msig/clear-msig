"use client";

// Send ETH (Sepolia) — purpose-built sibling of /send.
//
// The Solana send path is the original /send/page.tsx, untouched.
// This page exists for cross-chain. The flow:
//
//   1. Read the wallet's EVM binding (Ika dWallet → Sepolia address).
//      No binding => bounce to /chains/add.
//   2. Read the wallet's EVM intent (intent_index for the
//      EvmTransfer template). No intent => bounce to /setup/eth.
//   3. User enters recipient (0x...) + amount in ETH + optional note.
//   4. Frontend fetches the wallet's current EVM nonce from the
//      destination RPC.
//   5. prepare.createProposal with intent_index + EVM params.
//   6. signMessage on Solana (the multisig is on Solana — your
//      signature gates the EVM-side action).
//   7. submit.createProposal lands the proposal Approved on chain
//      (program auto-approves proposer-in-approvers, mirrors the
//      SolTransfer setup ceremony).
//   8. executeProposal with broadcast=true and Ika dWallet params
//      so the dWallet network signs + broadcasts the actual ETH tx
//      to Sepolia.
//
// SignPayloadPreview shows the user the EVM-side facts BEFORE the
// wallet popup fires: chain, recipient, amount-in-ETH, the budget
// impact under the policy. The wallet popup itself still shows the
// raw Solana sign-message bytes because we cannot change what
// Phantom / Solflare render; the disclaimer in WalletPopupNarration
// reminds them that's normal.

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection, useWallet } from "@/lib/wallet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Send,
  ShieldAlert,
} from "lucide-react";
import { backendApi } from "@/lib/api/endpoints";
import { friendlyError } from "@/lib/api/errors";
import { fromHex, IntentType } from "@/lib/msig";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import {
  ethToWei,
  fetchEvmNonce,
  isValidEvmAddress,
  shortEvmAddress,
} from "@/lib/chain/eth";
import { useWalletChains, chainAddress } from "@/lib/hooks/useWalletChains";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/retail/Button";
import { BrandLoader } from "@/components/retail/BrandLoader";
import { ChainBadge } from "@/components/retail/ChainBadge";
import { WalletPopupNarration } from "@/components/retail/WalletPopupNarration";
import { StickyTopBar } from "@/components/retail/StickyTopBar";
import { SendChainPicker } from "@/components/retail/SendChainPicker";
import {
  SignPayloadPreview,
  type SignPayloadDetail,
} from "@/components/retail/SignPayloadPreview";
import { chainByKind } from "@/lib/retail/chains";
import { appConfig } from "@/lib/config";

const ETH_CHAIN_KIND = 1;

type Stage = "compose" | "sending" | "sent";

export default function SendEthPageWrapper() {
  return (
    <Suspense
      fallback={<main className="min-h-screen bg-canvas" aria-hidden="true" />}
    >
      <SendEthPage />
    </Suspense>
  );
}

function SendEthPage() {
  const router = useRouter();
  const params = useSearchParams();
  const reduce = useReducedMotion();
  const wallet = useWallet();
  const { connection } = useConnection();
  const { signBytes } = useSignWithWallet();
  const toast = useToast();
  const queryClient = useQueryClient();

  const walletName = params?.get("wallet")?.trim() || "";

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
      return listIntents(
        connection,
        walletQuery.data.pda,
        walletQuery.data.account.intentIndex,
      );
    },
    enabled: !!walletQuery.data,
    staleTime: 30_000,
  });
  const chainsQuery = useWalletChains(walletName);

  // Match the wallet's EvmTransfer intent (chainKind === 1) and the
  // Ethereum binding. Both must be present to send.
  const ethIntent = useMemo(() => {
    if (!intentsQuery.data) return null;
    return (
      intentsQuery.data.find(
        (it) =>
          it.account !== null &&
          it.account.intentType === IntentType.Custom &&
          it.account.chainKind === ETH_CHAIN_KIND,
      ) ?? null
    );
  }, [intentsQuery.data]);
  const ethBinding = useMemo(() => {
    return (chainsQuery.data?.chains ?? []).find(
      (b) => b.chain_kind === ETH_CHAIN_KIND,
    );
  }, [chainsQuery.data]);
  const walletEthAddress = ethBinding ? chainAddress(ethBinding) : null;

  const allLoaded =
    !walletQuery.isLoading &&
    !intentsQuery.isLoading &&
    !chainsQuery.isLoading;
  const needsBinding = allLoaded && !ethBinding;
  const needsIntent = allLoaded && !!ethBinding && !ethIntent;

  const [stage, setStage] = useState<Stage>("compose");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [note, setNote] = useState("");
  const [sentLabel, setSentLabel] = useState<{
    amount: string;
    to: string;
  } | null>(null);

  const trimmedRecipient = recipient.trim();
  const recipientValid = isValidEvmAddress(trimmedRecipient);
  let amountValid = false;
  let amountWei = 0n;
  try {
    if (amount.trim()) {
      amountWei = ethToWei(amount);
      amountValid = amountWei > 0n;
    }
  } catch {
    amountValid = false;
  }
  const canSubmit =
    amountValid &&
    recipientValid &&
    !!ethIntent &&
    !!walletEthAddress &&
    !!wallet.publicKey;

  const submit = useMutation({
    mutationFn: async () => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first");
      if (!ethIntent || !ethIntent.account)
        throw new Error("Ethereum sending isn't set up for this wallet");
      if (!walletEthAddress)
        throw new Error("Wallet's Ethereum address isn't ready yet");
      if (!recipientValid) throw new Error("Recipient must be a valid 0x address");

      // 1. Pull the live nonce. Without this the EVM tx the dWallet
      //    signs gets rejected as a duplicate.
      const { nonce } = await fetchEvmNonce(walletEthAddress);

      // 2. Prepare. The CLI encodes nonce/to/value_wei/data into
      //    params_data per the evm_transfer_sepolia template.
      const dry = await backendApi.prepare.createProposal(walletName, {
        intent_index: ethIntent.account.intentIndex,
        params: [
          `nonce=${nonce}`,
          `to=${trimmedRecipient}`,
          `value_wei=${amountWei.toString()}`,
          `data=`,
        ],
        actor_pubkey: wallet.publicKey.toBase58(),
      });

      // 3. Sign on Solana. Proves to the program that this user is
      //    a proposer + counts as their approval.
      const signed = await signBytes(fromHex(dry.message_hex));

      // 4. Submit. Lands the proposal Approved on chain (program's
      //    auto-approve when proposer-in-approvers).
      const submitted = await backendApi.submit.createProposal(walletName, {
        ...signed,
        params_data_hex: dry.params_data_hex,
        expiry: dry.expiry,
        intent_index: ethIntent.account.intentIndex,
      });
      const proposal = (submitted as Record<string, unknown>)?.proposal;
      if (typeof proposal !== "string" || proposal.length === 0) {
        throw new Error("Backend didn't return a proposal address from submit");
      }

      // Old-program fallback: re-sign approve if the propose did not
      // auto-approve. With the upgrade this branch never fires.
      const decision = await approveIfNeeded(connection, proposal);
      if (decision.needsApproveSignature) {
        const approveDry = await backendApi.prepare.approveProposal(
          walletName,
          proposal,
          { actor_pubkey: wallet.publicKey.toBase58() },
        );
        const approveSigned = await signBytes(fromHex(approveDry.message_hex));
        await backendApi.submit.approveProposal(walletName, proposal, {
          ...approveSigned,
          expiry: approveDry.expiry,
        });
      }

      // 5. Execute with broadcast=true and Ika dWallet params. The
      //    backend tells Ika to sign + broadcast the EVM tx; the
      //    dWallet's secp256k1 signature lands the real Sepolia tx.
      await backendApi.executeProposal(walletName, proposal, {
        broadcast: true,
        dwallet_program: appConfig.preAlpha.dwalletProgramId,
        grpc_url: appConfig.preAlpha.grpcUrl,
        rpc_url: appConfig.preAlpha.destinationRpcUrl,
      });
      return proposal;
    },
    onSuccess: () => {
      setSentLabel({
        amount: amount.trim(),
        to: shortEvmAddress(trimmedRecipient),
      });
      queryClient.invalidateQueries({ queryKey: ["proposals", walletName] });
      setStage("sent");
    },
    onError: (err) => {
      console.error("[send-eth]", err);
      const fe = friendlyError(err, "send");
      toast.error(fe.title, { details: fe.body });
      setStage("compose");
    },
  });

  const handleSubmit = () => {
    setStage("sending");
    submit.mutate();
  };

  const motionProps = reduce
    ? { initial: false as const, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };

  // Short-circuit renders for the two pre-flight gates. Bounces are
  // explicit links rather than auto-redirects so the user understands
  // why they were moved.
  if (allLoaded && needsBinding) {
    return (
      <PreFlightCard
        title="Add Ethereum to this wallet first"
        body="This wallet doesn't have an Ethereum address yet. Adding Ethereum spins up its dWallet (about 30 seconds), then you can come back here."
        cta={{
          href: `/app/wallet/${encodeURIComponent(walletName)}/chains/add`,
          label: "Add Ethereum",
        }}
        walletName={walletName}
      />
    );
  }
  if (allLoaded && needsIntent) {
    return (
      <PreFlightCard
        title="Enable Ethereum sending first"
        body="Ethereum is bound to this wallet, but the spending rule for it isn't set up yet. One quick setup, then sends are unlocked."
        cta={{
          href: `/app/wallet/${encodeURIComponent(walletName)}/setup/eth`,
          label: "Enable Ethereum sending",
        }}
        walletName={walletName}
      />
    );
  }

  return (
    <main className="relative flex min-h-screen flex-col bg-canvas">
      <StickyTopBar innerClassName="justify-between gap-3">
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
          {walletName || "your shared wallet"} · ETH (Sepolia)
        </span>
      </StickyTopBar>

      <div className="relative z-10 flex flex-1 justify-center px-gutter py-10">
        <motion.section
          {...motionProps}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-md"
        >
          {stage === "compose" && (
            <SendChainPicker walletName={walletName} activeKind={ETH_CHAIN_KIND} />
          )}
          {stage === "compose" && (
            <ComposeStage
              walletName={walletName}
              walletEthAddress={walletEthAddress}
              amount={amount}
              setAmount={setAmount}
              recipient={recipient}
              setRecipient={setRecipient}
              recipientValid={recipientValid}
              note={note}
              setNote={setNote}
              amountValid={amountValid}
              canSubmit={canSubmit}
              onSubmit={handleSubmit}
              reduce={!!reduce}
            />
          )}
          {stage === "sending" && <SendingStage reduce={!!reduce} />}
          {stage === "sent" && sentLabel && (
            <SentStage
              amount={sentLabel.amount}
              to={sentLabel.to}
              walletName={walletName}
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
        </motion.section>
      </div>
    </main>
  );
}

// ─── Compose stage ────────────────────────────────────────────────

interface ComposeStageProps {
  walletName: string;
  walletEthAddress: string | null;
  amount: string;
  setAmount: (s: string) => void;
  recipient: string;
  setRecipient: (s: string) => void;
  recipientValid: boolean;
  note: string;
  setNote: (s: string) => void;
  amountValid: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  reduce: boolean;
}

function ComposeStage({
  walletName,
  walletEthAddress,
  amount,
  setAmount,
  recipient,
  setRecipient,
  recipientValid,
  note,
  setNote,
  amountValid,
  canSubmit,
  onSubmit,
}: ComposeStageProps) {
  const ethMeta = chainByKind(ETH_CHAIN_KIND);

  const previewDetails: SignPayloadDetail[] = [
    { label: "From wallet", value: walletName || "your wallet" },
    { label: "Chain", value: "Ethereum (Sepolia)" },
    walletEthAddress
      ? {
          label: "From address",
          value: shortEvmAddress(walletEthAddress),
          emphasis: "mono",
        }
      : { label: "From address", value: "spinning up" },
  ];
  if (recipientValid) {
    previewDetails.push({
      label: "Recipient",
      value: shortEvmAddress(recipient),
      emphasis: "mono",
    });
  }
  if (amountValid) {
    previewDetails.push({
      label: "Amount",
      value: `${amount.trim()} ETH`,
      emphasis: "amount",
    });
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col items-center text-center">
        {ethMeta && <ChainBadge chain={ethMeta} size="lg" />}
        <h1 className="mt-4 font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          Send ETH from {walletName}
        </h1>
        <p className="mt-2 text-base text-text-soft">
          On Sepolia, the Ethereum testnet. Don&rsquo;t send mainnet ETH
          here.
        </p>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        <Field
          label="Amount"
          hint={amount.trim() && !amountValid ? "Must be a positive number." : undefined}
        >
          <div className="flex items-baseline gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                const stripped = e.target.value.replace(/[^\d.]/g, "");
                const [whole = "", frac] = stripped.split(".");
                const next =
                  frac === undefined
                    ? whole.slice(0, 12)
                    : `${whole.slice(0, 12)}.${frac.slice(0, 18)}`;
                setAmount(next);
              }}
              placeholder="0.05"
              className={
                "flex-1 rounded-card border border-border-soft bg-surface-raised px-4 py-3 font-display text-2xl text-text-strong outline-none " +
                "transition-[border-color,box-shadow] duration-base ease-out-soft " +
                "focus:border-accent focus:shadow-accent-rest"
              }
            />
            <span className="text-sm font-medium text-text-soft">ETH</span>
          </div>
        </Field>

        <Field
          label="Recipient"
          hint={
            recipient.trim() && !recipientValid
              ? "Must be a 0x… 42-character Ethereum address."
              : undefined
          }
        >
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="0x…"
            className={
              "w-full rounded-card border border-border-soft bg-surface-raised px-4 py-3 font-mono text-sm text-text-strong outline-none " +
              "transition-[border-color,box-shadow] duration-base ease-out-soft " +
              "focus:border-accent focus:shadow-accent-rest"
            }
          />
        </Field>

        <Field label="Note (optional)">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 80))}
            placeholder="What's it for?"
            className={
              "w-full rounded-card border border-border-soft bg-surface-raised px-4 py-3 text-sm text-text-strong outline-none " +
              "transition-[border-color,box-shadow] duration-base ease-out-soft " +
              "focus:border-accent focus:shadow-accent-rest"
            }
          />
        </Field>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        <SignPayloadPreview
          action={
            amountValid && recipientValid
              ? `Send ${amount.trim()} ETH to ${shortEvmAddress(recipient)}`
              : "Fill in the amount and recipient above"
          }
          details={previewDetails}
          warning="Cross-chain send is in alpha. The on-chain Solana sig you give here authorises Ika's dWallet network to broadcast the actual Ethereum tx. If anything is wrong with the EVM-side params, the broadcast fails and the wallet's Solana state stays untouched."
        />
        <WalletPopupNarration action="send this Ethereum request" popups={1} />
      </div>

      <Button
        size="lg"
        fullWidth
        className="mt-3"
        disabled={!canSubmit}
        onClick={onSubmit}
      >
        Send request
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}

function Field({ label, hint, children }: FieldProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
        {label}
      </span>
      {children}
      {hint && (
        <span className="text-[11px] text-warning">{hint}</span>
      )}
    </label>
  );
}

// ─── Sending + sent stages ────────────────────────────────────────

function SendingStage({ reduce }: { reduce: boolean }) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, scale: 0.96 }, animate: { opacity: 1, scale: 1 } };
  return (
    <motion.div
      {...motionProps}
      transition={{ duration: 0.35 }}
      className="flex flex-col items-center text-center"
    >
      <BrandLoader size={48} label="Sending Ethereum request" />
      <h2 className="mt-5 font-display text-display-xs text-text-strong">
        Talking to Ethereum
      </h2>
      <p className="mt-1 text-sm text-text-soft">
        Building the request, signing on Solana, then handing off to
        Ika&rsquo;s dWallet network to broadcast on Sepolia.
      </p>
    </motion.div>
  );
}

interface SentStageProps {
  amount: string;
  to: string;
  walletName: string;
  onDone: () => void;
  reduce: boolean;
}

function SentStage({ amount, to, walletName, onDone, reduce }: SentStageProps) {
  return (
    <div className="flex flex-col items-center text-center">
      <motion.div
        initial={reduce ? false : { scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", damping: 18, stiffness: 220 }}
        className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-accent text-white shadow-accent-rest"
      >
        <Check className="h-10 w-10" strokeWidth={2.5} />
      </motion.div>
      <h2 className="font-display text-display-sm text-text-strong">
        {amount} ETH on the way to {to}
      </h2>
      <p className="mt-2 text-sm text-text-soft">
        Approved + broadcast through Ika. Watch for it on Sepolia.
      </p>
      <Button size="lg" fullWidth className="mt-8 max-w-xs" onClick={onDone}>
        Back to {walletName}
      </Button>
    </div>
  );
}

// ─── Pre-flight cards (binding / intent missing) ──────────────────

function PreFlightCard({
  title,
  body,
  cta,
  walletName,
}: {
  title: string;
  body: string;
  cta: { href: string; label: string };
  walletName: string;
}) {
  return (
    <main className="relative flex min-h-screen flex-col bg-canvas">
      <StickyTopBar>
        <Link
          href={
            walletName
              ? `/app/wallet/${encodeURIComponent(walletName)}`
              : "/app/wallet"
          }
          className={
            "-ml-2 inline-flex items-center gap-1.5 rounded-soft px-2 py-1 text-sm text-text-soft " +
            "transition-colors duration-base ease-out-soft hover:text-text-strong " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          }
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {walletName || "Wallets"}
        </Link>
      </StickyTopBar>
      <div className="relative z-10 flex flex-1 items-center justify-center px-gutter py-10">
        <div className="w-full max-w-md text-center">
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-warning/10 text-warning">
            <ShieldAlert className="h-6 w-6" strokeWidth={1.75} />
          </div>
          <h1 className="font-display text-display-xs text-text-strong text-balance">
            {title}
          </h1>
          <p className="mt-2 text-base text-text-soft">{body}</p>
          <Link href={cta.href} className="mt-6 inline-block w-full">
            <Button size="lg" fullWidth>
              {cta.label}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
