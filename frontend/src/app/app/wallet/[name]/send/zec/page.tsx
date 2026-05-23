"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection, useWallet } from "@/lib/wallet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, Send } from "lucide-react";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { IntentType } from "@/lib/msig";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import { toDisplayName } from "@/lib/retail/walletNames";
import { backendApi } from "@/lib/api/endpoints";
import { friendlyError } from "@/lib/api/errors";
import { encryptPolicyBatch } from "@/lib/encrypt/client";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { useWalletChains, chainAddress } from "@/lib/hooks/useWalletChains";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/retail/Button";
import { ChainBadge } from "@/components/retail/ChainBadge";
import { BrandLoader } from "@/components/retail/BrandLoader";
import { WalletPopupNarration } from "@/components/retail/WalletPopupNarration";
import {
  SignPayloadPreview,
  type SignPayloadDetail,
} from "@/components/retail/SignPayloadPreview";
import {
  SendReceipt,
  type ReceiptDetail,
} from "@/components/retail/SendReceipt";
import { UsdHint } from "@/components/retail/UsdHint";
import { SendChainPicker } from "@/components/retail/SendChainPicker";
import { PolicyMatchBanner } from "@/components/security/PolicyMatchBanner";
import { usePolicyEvaluation } from "@/lib/hooks/usePolicyEvaluation";
import { resolvePolicyEnforcement } from "@/lib/policies/enforce";
import { chainByKind } from "@/lib/retail/chains";
import { appConfig } from "@/lib/config";
import {
  decodeZcashTransparentAddress,
  fetchZcashBalance,
  fetchZcashUtxos,
  networkForZcashAddress,
  validateZcashDestination,
} from "@/lib/chain/zcash";
import { parseBtcAmount, formatSats, reverseHex } from "@/lib/chain/btc";
import { shortEvmAddress } from "@/lib/chain/eth";
import { recordAttempt } from "@/lib/retail/txLog";
import { broadcastExplorerUrl, explorerLabelForChainKind } from "@/lib/explorer";

const ZEC_TEMPLATE = "examples/intents/zcash_transfer.json";
const ZEC_CHAIN_KIND = 3;
const FEE_RESERVE_ZATS = 1000n;

type Stage = "compose" | "sending" | "sent";

export default function ZcashSendPage() {
  const params = useParams<{ name: string }>();
  const name = useMemo(() => {
    try {
      return decodeURIComponent(params?.name ?? "");
    } catch {
      return params?.name ?? "";
    }
  }, [params?.name]);
  const reduce = useReducedMotion();
  const wallet = useWallet();
  const { connection } = useConnection();
  const { signDescriptor } = useSignWithWallet();
  const toast = useToast();
  const queryClient = useQueryClient();
  const walletDisplay = toDisplayName(name);

  const walletQuery = useQuery({
    queryKey: ["wallet", name],
    queryFn: () => fetchWalletByName(connection, name),
    enabled: name.length > 0,
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
    refetchOnMount: "always",
  });
  const chainsQuery = useWalletChains(name);
  const zcashBinding = useMemo(
    () => (chainsQuery.data?.chains ?? []).find((b) => b.chain_kind === ZEC_CHAIN_KIND) ?? null,
    [chainsQuery.data],
  );
  const zcashAddress = zcashBinding ? chainAddress(zcashBinding) : null;
  const senderDecoded = zcashAddress ? decodeZcashTransparentAddress(zcashAddress) : null;
  const zcashNetwork = zcashAddress ? networkForZcashAddress(zcashAddress) ?? "testnet" : "testnet";

  const zcashIntent = useMemo(() => {
    return (intentsQuery.data ?? [])
      .map((it) => it.account)
      .find(
        (a) =>
          a !== null &&
          a.intentType === IntentType.Custom &&
          a.chainKind === ZEC_CHAIN_KIND,
      );
  }, [intentsQuery.data]);

  const allSettled =
    !walletQuery.isLoading &&
    !intentsQuery.isLoading &&
    !chainsQuery.isLoading &&
    !intentsQuery.isFetching &&
    !chainsQuery.isFetching;
  const needsBinding = allSettled && !zcashBinding;
  const needsIntent = allSettled && !!zcashBinding && !zcashIntent;
  const [stage, setStage] = useState<Stage>("compose");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [sentLabel, setSentLabel] = useState<{
    amount: string;
    to: string;
    explorerUrl: string | null;
    explorerLabel: string;
  } | null>(null);

  const recipientDecoded = useMemo(
    () => validateZcashDestination(recipient),
    [recipient],
  );
  const recipientValid = recipientDecoded.ok;
  const effectiveRecipient = recipientValid ? recipientDecoded.pkh : null;
  const amountZats = useMemo(() => parseBtcAmount(amount), [amount]);
  const amountValid = amountZats !== null && amountZats > 0n;

  const balanceQuery = useQuery({
    queryKey: ["zcash-balance", zcashAddress ?? "", zcashNetwork],
    queryFn: () =>
      zcashAddress ? fetchZcashBalance(appConfig.preAlpha.zcashRpcUrl, zcashAddress) : 0n,
    enabled: !!zcashAddress,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
  });
  const utxosQuery = useQuery({
    queryKey: ["zcash-utxos", zcashAddress ?? "", zcashNetwork],
    queryFn: () =>
      zcashAddress ? fetchZcashUtxos(appConfig.preAlpha.zcashRpcUrl, zcashAddress) : [],
    enabled: !!zcashAddress,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
  });
  const zcashBalance = balanceQuery.data ?? null;
  const selectedUtxo = useMemo(() => {
    if (!amountValid || !amountZats || !utxosQuery.data) return null;
    const needed = amountZats + FEE_RESERVE_ZATS;
    return utxosQuery.data.find((u) => u.satoshis >= needed) ?? null;
  }, [amountValid, amountZats, utxosQuery.data]);
  const insufficientBalance =
    zcashBalance !== null &&
    amountValid &&
    amountZats !== null &&
    zcashBalance < amountZats + FEE_RESERVE_ZATS;

  const policyEvaluation = usePolicyEvaluation({
    walletName: name,
    chainKind: ZEC_CHAIN_KIND,
    recipient: recipient,
    ticker: "ZEC",
    amountDisplay: amount,
    enabled: amountValid && recipientValid,
  });
  const policyDenied =
    policyEvaluation?.matched && policyEvaluation.action === "deny";

  const setup = useMutation({
    mutationFn: async () => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first");
      if (!zcashBinding) throw new Error("Bind Zcash to this wallet first");
      const signerPk = wallet.publicKey;
      const enc = new TextEncoder();
      const encrypted = await encryptPolicyBatch([
        { plaintext: enc.encode(JSON.stringify([signerPk.toBase58()])), fheType: "ebytes" },
        { plaintext: enc.encode(JSON.stringify([signerPk.toBase58()])), fheType: "ebytes" },
        { plaintext: new Uint8Array([1]), fheType: "euint8" },
        { plaintext: new Uint8Array([0]), fheType: "euint32" },
      ]);
      const policy_ciphertexts = encrypted
        .map((p) => p.ciphertextIdentifier)
        .filter((id): id is string => typeof id === "string");
      const dry = await backendApi.prepare.addIntent(name, {
        file: ZEC_TEMPLATE,
        proposers: [signerPk.toBase58()],
        approvers: [signerPk.toBase58()],
        threshold: 1,
        cancellation_threshold: 1,
        timelock: 0,
        policy_ciphertexts,
      });
      const signed = await signDescriptor(dry, { preferSigner: signerPk });
      const submitted = await backendApi.submit.addIntent(name, {
        ...signed,
        params_data_hex: dry.params_data_hex,
        expiry: dry.expiry,
        file: ZEC_TEMPLATE,
      });
      const proposal = (submitted as Record<string, unknown>)?.proposal;
      if (typeof proposal !== "string" || proposal.length === 0) {
        throw new Error("Backend didn't return a proposal address from setup");
      }
      const decision = await approveIfNeeded(connection, proposal);
      if (decision.needsApproveSignature) {
        const approveDry = await backendApi.prepare.approveProposal(name, proposal, {
          actor_pubkey: signerPk.toBase58(),
        });
        const approveSigned = await signDescriptor(approveDry, {
          preferSigner: signerPk,
        });
        await backendApi.submit.approveProposal(name, proposal, {
          ...approveSigned,
          expiry: approveDry.expiry,
        });
      }
      await backendApi.executeProposal(name, proposal, {});
      return proposal;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wallet-intents"] });
      queryClient.invalidateQueries({ queryKey: ["wallet", name] });
      toast.success(`${walletDisplay} can now send ZEC`);
      setStage("compose");
    },
    onError: (err) => {
      console.error("[setup-zec]", err);
      const fe = friendlyError(err, "set-up-spending");
      toast.error(fe.title, { details: fe.body });
    },
  });

  const send = useMutation({
    mutationFn: async () => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first");
      if (!zcashIntent) {
        throw new Error("Zcash sending isn't set up for this wallet");
      }
      if (!zcashAddress || !senderDecoded) {
        throw new Error("Wallet's Zcash address isn't ready yet");
      }
      if (!amountValid || !amountZats) throw new Error("Enter an amount");
      if (!recipientValid || !effectiveRecipient) {
        throw new Error("Recipient must be a valid transparent Zcash address");
      }
      if (!selectedUtxo) {
        throw new Error("No UTXO large enough to cover the send amount");
      }
      if (recipientDecoded.network !== zcashNetwork) {
        throw new Error("Recipient network does not match the wallet's Zcash network");
      }
      const signerPk = wallet.publicKey;

      const dry = await backendApi.prepare.createProposal(name, {
        intent_index: zcashIntent.intentIndex,
        params: [
          `prev_txid=${reverseHex(selectedUtxo.txid)}`,
          `prev_vout=${selectedUtxo.vout}`,
          `prev_amount_zat=${selectedUtxo.satoshis.toString()}`,
          `sender_pkh=${bytesToHex(senderDecoded.pkh)}`,
          `recipient_pkh=${bytesToHex(effectiveRecipient)}`,
          `send_amount_zat=${amountZats.toString()}`,
        ],
        actor_pubkey: signerPk.toBase58(),
      });
      const signed = await signDescriptor(dry, { preferSigner: signerPk });
      const submitted = await backendApi.submit.createProposal(name, {
        ...signed,
        params_data_hex: dry.params_data_hex,
        expiry: dry.expiry,
        intent_index: zcashIntent.intentIndex,
      });
      const proposal = (submitted as Record<string, unknown>)?.proposal;
      if (typeof proposal !== "string" || proposal.length === 0) {
        throw new Error("Backend didn't return a proposal address from submit");
      }
      const decision = await approveIfNeeded(connection, proposal);
      if (decision.needsApproveSignature) {
        const approveDry = await backendApi.prepare.approveProposal(name, proposal, {
          actor_pubkey: signerPk.toBase58(),
        });
        const approveSigned = await signDescriptor(approveDry, {
          preferSigner: signerPk,
        });
        await backendApi.submit.approveProposal(name, proposal, {
          ...approveSigned,
          expiry: approveDry.expiry,
        });
      }
      const policyPlan = await resolvePolicyEnforcement(name, {
        walletName: name,
        chainKind: ZEC_CHAIN_KIND,
        recipient,
        ticker: "ZEC",
        amountDisplay: amount,
      });
      if (policyPlan.evaluation?.matched && policyPlan.rule?.action === "require-cooldown") {
        await new Promise((resolve) =>
          setTimeout(resolve, (policyPlan.extraCooldownSeconds ?? 0) * 1000),
        );
      }
      const executed = await backendApi.executeProposal(name, proposal, {
        broadcast: true,
        dwallet_program: appConfig.preAlpha.dwalletProgramId,
        grpc_url: appConfig.preAlpha.grpcUrl,
        rpc_url: appConfig.preAlpha.zcashRpcUrl,
      });
      const broadcast = (executed as { broadcast?: { chain_kind?: number; tx_id?: string } })
        ?.broadcast;
      return { proposal, broadcast };
    },
    onSuccess: ({ broadcast }) => {
      const explorerUrl = broadcastExplorerUrl(broadcast, appConfig.preAlpha.zcashRpcUrl);
      const explorerLabel = explorerLabelForChainKind(broadcast?.chain_kind, appConfig.preAlpha.zcashRpcUrl);
      const recipientText = recipient;
      setSentLabel({
        amount: amount.trim(),
        to: recipientText,
        explorerUrl,
        explorerLabel,
      });
      recordAttempt({
        walletName: name,
        chainKind: ZEC_CHAIN_KIND,
        status: "success",
        amountDisplay: amount.trim(),
        ticker: "ZEC",
        recipientShort: recipientText,
        recipientFull: recipientText,
        txId: broadcast?.tx_id,
        explorerUrl: explorerUrl ?? undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["proposals", name] });
      queryClient.invalidateQueries({ queryKey: ["wallet-other-chain-balances"] });
      queryClient.invalidateQueries({ queryKey: ["chain-balance"] });
      setStage("sent");
    },
    onError: (err) => {
      console.error("[send-zec]", err);
      const fe = friendlyError(err, "send");
      toast.error(fe.title, { details: fe.body });
      setStage("compose");
    },
  });

  if (allSettled && needsBinding) {
    return (
      <PreFlightCard
        title="Add Zcash to this wallet first"
        body="This wallet doesn't have a Zcash address yet. Add Zcash on the chains page, then come back here."
        cta={{
          href: `/app/wallet/${encodeURIComponent(name)}/chains/add`,
          label: "Add Zcash",
        }}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col lg:max-w-3xl">
      <div className="flex flex-1 flex-col">
        <motion.section
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="w-full"
        >
          {stage === "compose" && (
            <SendChainPicker walletName={name} activeKind={ZEC_CHAIN_KIND} />
          )}
          {stage === "compose" && policyEvaluation?.matched && (
            <PolicyMatchBanner walletName={name} evaluation={policyEvaluation} />
          )}
          {stage === "compose" && needsIntent && (
            <div className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-text-soft">
                Enable Zcash sending
              </p>
              <p className="mt-2 text-sm text-text-soft">
                This wallet has a Zcash address, but the spending rule is not live yet.
              </p>
              <Button size="lg" fullWidth className="mt-4" onClick={() => setup.mutate()} disabled={setup.isPending || !zcashBinding}>
                {setup.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Enabling
                  </>
                ) : (
                  <>
                    Enable Zcash sending
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </>
                )}
              </Button>
            </div>
          )}
          {stage === "compose" && !needsIntent && (
            <ZcashCompose
              walletDisplay={walletDisplay}
              walletAddress={zcashAddress}
              balance={zcashBalance}
              amount={amount}
              setAmount={setAmount}
              recipient={recipient}
              setRecipient={setRecipient}
              recipientDecoded={recipientDecoded}
              amountValid={amountValid}
              recipientValid={recipientValid}
              selectedUtxo={selectedUtxo}
              insufficientBalance={insufficientBalance}
              canSubmit={!policyDenied && amountValid && recipientValid && !!selectedUtxo && !insufficientBalance && !!wallet.publicKey}
              onSubmit={() => {
                setStage("sending");
                send.mutate();
              }}
            />
          )}
          {stage === "sending" && <SendingStage />}
          {stage === "sent" && sentLabel && (
            <SentStage
              walletName={name}
              walletDisplay={walletDisplay}
              amount={sentLabel.amount}
              to={sentLabel.to}
              explorerUrl={sentLabel.explorerUrl}
              explorerLabel={sentLabel.explorerLabel}
            />
          )}
        </motion.section>
      </div>
    </div>
  );
}

function PreFlightCard({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta: { href: string; label: string };
}) {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col lg:max-w-3xl">
      <div className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
          Zcash send
        </p>
        <h1 className="mt-2 font-display text-2xl font-semibold leading-tight tracking-tight text-text-strong">
          {title}
        </h1>
        <p className="mt-2 text-sm text-text-soft">{body}</p>
        <Link
          href={cta.href}
          className="mt-4 inline-flex items-center gap-1.5 rounded-soft bg-accent px-3.5 py-2 text-sm font-medium text-text-on-accent shadow-accent-rest"
        >
          {cta.label}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

function ZcashCompose({
  walletDisplay,
  walletAddress,
  balance,
  amount,
  setAmount,
  recipient,
  setRecipient,
  recipientDecoded,
  amountValid,
  recipientValid,
  selectedUtxo,
  insufficientBalance,
  canSubmit,
  onSubmit,
}: {
  walletDisplay: string;
  walletAddress: string | null;
  balance: bigint | null;
  amount: string;
  setAmount: (s: string) => void;
  recipient: string;
  setRecipient: (s: string) => void;
  recipientDecoded: ReturnType<typeof validateZcashDestination>;
  amountValid: boolean;
  recipientValid: boolean;
  selectedUtxo: { txid: string; vout: number; satoshis: bigint } | null;
  insufficientBalance: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
}) {
  const zecMeta = chainByKind(ZEC_CHAIN_KIND);
  const details: SignPayloadDetail[] = [
    { label: "From wallet", value: walletDisplay || "your wallet" },
    { label: "Chain", value: "Zcash" },
    walletAddress
      ? { label: "From address", value: shortEvmAddress(walletAddress), emphasis: "mono" }
      : { label: "From address", value: "spinning up" },
  ];
  if (recipientValid) {
    details.push({ label: "Recipient", value: recipient, emphasis: "mono" });
  }
  if (amountValid) {
    details.push({ label: "Amount", value: `${amount.trim()} ZEC`, emphasis: "amount" });
  }
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-3">
          {zecMeta ? <ChainBadge chain={zecMeta} size="md" /> : null}
          <div className="flex flex-col gap-0.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
              Send · Zcash
            </p>
            <h1 className="hidden md:block font-display text-2xl font-semibold leading-tight tracking-tight text-text-strong sm:text-3xl">
              Send ZEC
            </h1>
          </div>
        </div>
        <p className="text-xs text-text-soft sm:text-sm">
          From <span className="font-medium text-text-strong">{walletDisplay}</span>
        </p>
      </header>

      <div className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2">
          <Field label="Amount">
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder="0"
              className="w-full rounded-card border border-border-soft bg-canvas px-4 py-3 text-sm text-text-strong outline-none"
            />
          </Field>
          <Field label="To" hint={recipient.trim() && !recipientValid ? recipientDecoded.ok ? undefined : recipientDecoded.reason : undefined}>
            <input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="t1… or tm…"
              className="w-full rounded-card border border-border-soft bg-canvas px-4 py-3 font-mono text-sm text-text-strong outline-none"
            />
          </Field>
        </div>
        <p className="mt-4 text-xs text-text-soft">
          Wallet has {balance !== null ? formatSats(balance) : "…"} ZEC
          {balance !== null ? <UsdHint amount={balance} smallestPerWhole={100_000_000n} ticker="ZEC" /> : null}
          {selectedUtxo ? (
            <span className="ml-2">Using input {selectedUtxo.txid.slice(0, 10)}…:{selectedUtxo.vout}</span>
          ) : null}
          {insufficientBalance ? <span className="ml-2 text-warning">Insufficient balance.</span> : null}
        </p>
      </div>

      <SignPayloadPreview action={amountValid && recipientValid ? `Send ${amount.trim()} ZEC` : "Fill in the amount and recipient above"} details={details} collapsibleDetails />
      <WalletPopupNarration action="send this Zcash request" />

      <div className="pt-1">
        <Button size="lg" fullWidth onClick={onSubmit} disabled={!canSubmit}>
          Send request
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium text-text-strong">
      <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
        {label}
      </span>
      {children}
      {hint ? <span className="text-xs text-warning">{hint}</span> : null}
    </label>
  );
}

function SendingStage() {
  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col items-center text-center"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-raised shadow-card-rest">
        <BrandLoader size={32} label="Sending Zcash request" />
      </div>
      <p className="mt-5 text-base text-text-strong">Talking to Zcash…</p>
      <p className="mt-1 text-xs text-text-soft">
        Signing on Solana, then handing off to Ika to broadcast on Zcash.
      </p>
    </motion.section>
  );
}

function SentStage({
  walletName,
  walletDisplay,
  amount,
  to,
  explorerUrl,
  explorerLabel,
}: {
  walletName: string;
  walletDisplay: string;
  amount: string;
  to: string;
  explorerUrl: string | null;
  explorerLabel: string;
}) {
  const details: ReceiptDetail[] = [
    { label: "From", value: walletDisplay },
    { label: "Network", value: "Zcash" },
  ];
  return (
    <SendReceipt
      status="confirmed"
      statusLabel="Broadcast on Zcash via Ika"
      amount={amount}
      ticker="ZEC"
      recipientLabel={to}
      details={details}
      explorerHref={explorerUrl}
      explorerLabel={explorerLabel}
      actions={[
        {
          label: "Send another",
          hint: "Same wallet, different recipient.",
          href: `/app/wallet/${encodeURIComponent(walletName)}/send/zec`,
          primary: true,
          icon: ArrowRight,
        },
        {
          label: "View activity",
          hint: "See proposals and wallet events.",
          href: `/app/wallet/${encodeURIComponent(walletName)}/activity`,
          icon: Send,
        },
      ]}
    />
  );
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
