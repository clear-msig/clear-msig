"use client";

// Set up sending - single-tap spending-rule bootstrap.
//
// A freshly-created wallet has no on-chain intents (spending rules)
// yet, so creating a request to send money fails. This screen wraps
// the prepare → sign → submit flow that adds a default SolTransfer
// intent into one user-visible action: "Set up sending."
//
// Approvers default to just the connected user (matching the
// /welcome flow's wallet-creation defaults). When the contacts /
// member-management layer lands, this should expand to the full
// member set.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection, useWallet } from "@/lib/wallet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { IntentType } from "@/lib/msig";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import { toDisplayName, toHeadingName } from "@/lib/retail/walletNames";
import { ArrowRight, Check, Loader2, Send, UserPlus, Wallet } from "lucide-react";
import { backendApi } from "@/lib/api/endpoints";
import { friendlyError } from "@/lib/api/errors";
import { encryptPolicyBatch } from "@/lib/encrypt/client";

import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { useToast } from "@/components/ui/Toast";
import { Breadcrumb } from "@/components/retail/Breadcrumb";
import { StickyTopBar } from "@/components/retail/StickyTopBar";
import { BackToWallets } from "@/components/retail/BackToWallets";
import { Button } from "@/components/retail/Button";
import { SignPayloadPreview } from "@/components/retail/SignPayloadPreview";
import { NextStepCard } from "@/components/retail/NextStepCard";

// Backend reads template files relative to the workspace root. The
// SolTransfer template gives the wallet a generic "send to anyone, any
// amount" rule - what a retail user expects from "send money."
const TEMPLATE_FILE = "examples/intents/solana_transfer.json";

export default function SetupSpendingPage() {
  const params = useParams<{ name: string }>();
  const name = useMemo(() => {
    try {
      return decodeURIComponent(params?.name ?? "");
    } catch {
      return params?.name ?? "";
    }
  }, [params?.name]);

  const router = useRouter();
  const wallet = useWallet();
  const { connection } = useConnection();
  const { signDescriptor } = useSignWithWallet();
  const toast = useToast();
  const reduce = useReducedMotion();
  const queryClient = useQueryClient();

  // Guard against landing here for a wallet that's already set up.
  // Without this, a user reloading /setup on a wallet with an
  // existing SolTransfer would happily start adding a duplicate
  // rule - second rule lands at a higher slot, /send picks the wrong
  // intent, and the wallet popup behavior gets confusing fast. The
  // guard is a redirect rather than a hidden CTA so the user
  // arriving at the page mistakenly is moved on to where they
  // actually want to be.
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
  });
  const alreadySetUp = useMemo(() => {
    return (intentsQuery.data ?? []).some(
      (it) => it.account?.intentType === IntentType.Custom,
    );
  }, [intentsQuery.data]);
  useEffect(() => {
    if (!name || intentsQuery.isLoading || walletQuery.isLoading) return;
    if (alreadySetUp) {
      router.replace(`/app/wallet/${encodeURIComponent(name)}`);
    }
  }, [
    name,
    intentsQuery.isLoading,
    walletQuery.isLoading,
    alreadySetUp,
    router,
  ]);

  const delaySeconds = 0;
  // Stays true after the on-chain enable lands so we can render the
  // NextStepCard inline instead of router.push'ing the user away.
  const [showDone, setShowDone] = useState(false);

  const setup = useMutation({
    mutationFn: async () => {
      if (!wallet.publicKey) {
        throw new Error("Connect your wallet first");
      }
      // Setup signs against the AddIntent meta-intent (slot 0),
      // whose approvers were set at wallet-create time. Resolve
      // which of our pubkeys (Ledger vs Dynamic embedded) is in
      // that approver list - without this, a user with both
      // signers connected can pick the wrong one and have the
      // on-chain verify reject. Mirror of the send pages' fix.
      const addIntent = (intentsQuery.data ?? []).find(
        (it) => it.account?.intentType === IntentType.AddIntent,
      );
      const signerPk = addIntent?.account
        ? wallet.pickSigner(addIntent.account.approvers)
        : wallet.publicKey;
      if (!signerPk) {
        throw new Error(
          "None of your connected wallets is in this wallet's approver list. " +
            "Disconnect the Ledger or sign in with the wallet that originally created this multisig.",
        );
      }
      const me = signerPk.toBase58();
      const proposers = [me];
      const approvers = [me];
      const threshold = 1;

      // 0. Encrypt the policy fields client-side via the Encrypt
      //    surface. Pre-alpha returns plaintext-as-ciphertext; the
      //    identifiers flow through to the backend + CLI so the
      //    full wire path is exercised.
      const enc = new TextEncoder();
      const encrypted = await encryptPolicyBatch([
        { plaintext: enc.encode(JSON.stringify(proposers)), fheType: "ebytes" },
        { plaintext: enc.encode(JSON.stringify(approvers)), fheType: "ebytes" },
        { plaintext: new Uint8Array([threshold]), fheType: "euint8" },
        { plaintext: new Uint8Array([delaySeconds & 0xff]), fheType: "euint32" },
      ]);
      const policy_ciphertexts = encrypted
        .map((p) => p.ciphertextIdentifier)
        .filter((id): id is string => typeof id === "string");

      // 1. Prepare: backend builds the unsigned add-intent transaction
      //    and returns the bytes the user has to sign.
      const dry = await backendApi.prepare.addIntent(name, {
        file: TEMPLATE_FILE,
        proposers,
        approvers,
        threshold,
        cancellation_threshold: 1,
        timelock: delaySeconds,
        policy_ciphertexts,
      });

      // 2. Sign: user's wallet pops up its sign-message UI.
      //    preferSigner routes through the matching Ledger/Dynamic
      //    pubkey resolved above.
      const signed = await signDescriptor(dry, { preferSigner: signerPk });

      // 3. Submit propose: lands the AddIntent proposal on chain in
      //    `Active` status with empty approval bitmap. The proposer's
      //    signature does NOT auto-flip an approval bit - that's a
      //    separate step.
      const submitted = await backendApi.submit.addIntent(name, {
        ...signed,
        params_data_hex: dry.params_data_hex,
        expiry: dry.expiry,
        file: TEMPLATE_FILE,
      });

      const proposal = (submitted as Record<string, unknown>)?.proposal;
      if (typeof proposal !== "string" || proposal.length === 0) {
        throw new Error(
          "Backend didn't return a proposal address from the propose step",
        );
      }

      // 4. Approve, but only if the propose didn't already flip the
      //    proposer's bit and meet threshold on chain. With the
      //    auto-approve program update this is the common case for
      //    1-of-1 wallets and the second popup goes away. Old
      //    program → still falls through to the explicit approve.
      const decision = await approveIfNeeded(connection, proposal);
      if (decision.needsApproveSignature) {
        const approveDry = await backendApi.prepare.approveProposal(
          name,
          proposal,
          { actor_pubkey: me },
        );
        const approveSigned = await signDescriptor(approveDry, {
          preferSigner: signerPk,
        });
        await backendApi.submit.approveProposal(name, proposal, {
          ...approveSigned,
          expiry: approveDry.expiry,
        });
      }

      // 5. Execute: now that the proposal is Approved, run it. The
      //    AddIntent meta-handler creates the SolTransfer intent and
      //    bumps `wallet.intent_index`. Sponsored by the relayer -
      //    no third user signature needed.
      await backendApi.executeProposal(name, proposal, {});
      return submitted;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wallet-intents"] });
      queryClient.invalidateQueries({ queryKey: ["wallet", name] });
      // Don't push the user away - render a NextStepCard inline so
      // they choose where to go next (send their first request,
      // invite someone, or back to the hub). The toast captures the
      // celebration; the card captures the next move.
      toast.success(`${toHeadingName(name)} is ready to send`);
      setShowDone(true);
    },
    onError: (err) => {
      console.error("[setup-spending]", err);
      const fe = friendlyError(err, "set-up-spending");
      toast.error(fe.title, { details: fe.body });
    },
  });

  const motionProps = reduce
    ? {}
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
      };

  return (
    <main className="relative flex min-h-screen flex-col bg-canvas">
      <StickyTopBar offset="header">
        <Breadcrumb
          segments={[
            { label: "Wallets", href: "/app/wallet" },
            { label: toDisplayName(name), href: `/app/wallet/${encodeURIComponent(name)}` },
            { label: "Turn on sending" },
          ]}
        />
      </StickyTopBar>
      {/* Mobile-only back chip - see /send for rationale. */}
      <div className="px-gutter pt-2 md:hidden">
        <BackToWallets />
      </div>

      <div className="relative z-10 flex flex-1 items-center justify-center px-gutter py-10">
        <motion.section
          {...motionProps}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-md"
        >
          {showDone ? (
            <div className="flex flex-col items-center text-center">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-accent text-text-on-accent shadow-accent-rest">
                <Check className="h-8 w-8" strokeWidth={2.5} />
              </div>
              <h1 className="font-display text-display-sm leading-[1.05] text-text-strong">
                <span className="text-accent">{toHeadingName(name)}</span> is ready to send
              </h1>
              <p className="mt-3 max-w-sm text-base text-text-soft">
                Sending is now turned on. The activity row you see is the
                sending protection going into effect. No money has moved yet.
              </p>
              <div className="mt-8 w-full">
                <NextStepCard
                  title={`What do you want to do in ${toDisplayName(name)}?`}
                  options={[
                    {
                      label: "Send your first request",
                      hint: "Pick someone, enter an amount, sign once.",
                      href: `/app/wallet/${encodeURIComponent(name)}/send`,
                      primary: true,
                      icon: Send,
                    },
                    {
                      label: "Invite someone",
                      hint: "Friend, teammate, or board member.",
                      href: `/app/wallet/${encodeURIComponent(name)}/members/add`,
                      icon: UserPlus,
                    },
                    {
                      label: `Back to ${toDisplayName(name)}`,
                      href: `/app/wallet/${encodeURIComponent(name)}`,
                      icon: Wallet,
                    },
                  ]}
                />
              </div>
            </div>
          ) : (
          <div className="flex flex-col items-center text-center">
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-accent">
              <Send className="h-7 w-7" strokeWidth={1.75} />
            </div>
            <span aria-hidden="true" className="block h-px w-10 bg-accent" />
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
              First-time setup
            </p>
            <h1 className="hidden md:block mt-2 font-display text-display-sm leading-[1.05] text-text-strong text-balance">
              Turn on sending in <span className="text-accent">{toHeadingName(name)}</span>
            </h1>

            <div className="mt-6 flex w-full flex-col gap-3">
              <SignPayloadPreview
                action="Turn on sending"
                details={[
                  { label: "Wallet", value: toDisplayName(name) },
                  {
                    label: "Chain",
                    value: "Solana",
                  },
                ]}
                collapsibleDetails
              />
            </div>

            <Button
              size="lg"
              fullWidth
              className="mt-3"
              onClick={() => setup.mutate()}
              disabled={setup.isPending}
            >
              {setup.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Setting up…
                </>
              ) : (
                <>
                  Turn on sending
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </>
              )}
            </Button>
          </div>
          )}
        </motion.section>
      </div>
    </main>
  );
}
