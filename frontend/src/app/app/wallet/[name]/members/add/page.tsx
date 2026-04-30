"use client";

// Add a friend — real signed flow that grows the wallet's approver
// list. The user types a friend's name + Solana address; we save the
// pair locally to contacts AND run the on-chain update-intent flow
// (prepare → sign → submit) so the friend can sign requests on this
// wallet from then on.
//
// Threshold isn't bumped automatically here — adding a friend keeps
// the existing X-of-Y count, just expands the Y. Changing approval
// thresholds is its own future flow.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Loader2, UserPlus } from "lucide-react";
import { backendApi } from "@/lib/api/endpoints";
import { BackendApiError } from "@/lib/api/client";
import { appConfig } from "@/lib/config";
import { encryptPolicyBatch } from "@/lib/encrypt/client";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { fromHex } from "@/lib/msig";
import { useSignWithWallet, WalletSignError } from "@/lib/hooks/useSignWithWallet";
import { useContacts } from "@/lib/hooks/useContacts";
import { isValidSolanaAddress, shortAddress } from "@/lib/retail/contacts";
import { Button } from "@/components/retail/Button";
import { MemberAvatar } from "@/components/retail/MemberAvatar";
import { useToast } from "@/components/ui/Toast";

// Same template the setup flow used. We're updating an existing
// intent's approvers, not changing the template, but the API needs
// the file path to round-trip the definition cleanly.
const TEMPLATE_FILE = "examples/intents/solana_transfer.json";

export default function AddFriendPage() {
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
  const { signBytes } = useSignWithWallet();
  const toast = useToast();
  const reduce = useReducedMotion();
  const queryClient = useQueryClient();
  const contacts = useContacts();

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
      const upTo = walletQuery.data.account.intentIndex - 1;
      if (upTo < 0) return [];
      return listIntents(connection, walletQuery.data.pda, upTo);
    },
    enabled: !!walletQuery.data,
    staleTime: 30_000,
  });

  const firstIntent = useMemo(() => {
    if (!intentsQuery.data) return null;
    return intentsQuery.data.find((it) => it.account !== null) ?? null;
  }, [intentsQuery.data]);

  // Bounce to setup if the wallet has no spending rule yet — there's
  // nothing to update.
  useEffect(() => {
    if (!name) return;
    if (walletQuery.isLoading || intentsQuery.isLoading) return;
    if (!walletQuery.data) return;
    if (firstIntent === null) {
      router.replace(`/app/wallet/${encodeURIComponent(name)}/setup`);
    }
  }, [
    name,
    walletQuery.isLoading,
    intentsQuery.isLoading,
    walletQuery.data,
    firstIntent,
    router,
  ]);

  const [friendName, setFriendName] = useState("");
  const [friendAddress, setFriendAddress] = useState("");

  const trimmedName = friendName.trim();
  const trimmedAddress = friendAddress.trim();
  const nameValid = trimmedName.length >= 2;
  const addressValid = isValidSolanaAddress(trimmedAddress);
  const alreadyMember =
    firstIntent?.account?.approvers.includes(trimmedAddress) ?? false;
  const canSubmit =
    nameValid && addressValid && !alreadyMember && !!firstIntent?.account;

  const addFriend = useMutation({
    mutationFn: async () => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first");
      const intent = firstIntent?.account;
      if (!intent) throw new Error("No spending rule on this wallet");

      const newApprovers = [...intent.approvers, trimmedAddress];
      // Mirror the friend into proposers so they can also create
      // requests, not just approve them.
      const newProposers = intent.proposers.includes(trimmedAddress)
        ? [...intent.proposers]
        : [...intent.proposers, trimmedAddress];

      // 0. Run the new approver/proposer lists through the Encrypt
      //    surface so the policy mutation flows as ciphertext IDs
      //    through frontend → backend → CLI. Alpha 1 + program
      //    `#[encrypt_fn]` upgrade routes them on chain.
      const enc = new TextEncoder();
      const encrypted = await encryptPolicyBatch([
        { plaintext: enc.encode(JSON.stringify(newProposers)), fheType: "ebytes" },
        { plaintext: enc.encode(JSON.stringify(newApprovers)), fheType: "ebytes" },
        { plaintext: new Uint8Array([intent.approvalThreshold]), fheType: "euint8" },
      ]);
      const policy_ciphertexts = encrypted
        .map((p) => p.ciphertextIdentifier)
        .filter((id): id is string => typeof id === "string");

      // 1. Prepare
      const dry = await backendApi.prepare.updateIntent(name, {
        index: intent.intentIndex,
        file: TEMPLATE_FILE,
        proposers: newProposers,
        approvers: newApprovers,
        threshold: intent.approvalThreshold,
        cancellation_threshold: intent.cancellationThreshold,
        timelock: intent.timelockSeconds,
        policy_ciphertexts,
      });

      // 2. Sign
      const signed = await signBytes(fromHex(dry.message_hex));

      // 3. Submit
      return backendApi.submit.updateIntent(name, {
        ...signed,
        params_data_hex: dry.params_data_hex,
        expiry: dry.expiry,
        index: intent.intentIndex,
        file: TEMPLATE_FILE,
      });
    },
    onSuccess: () => {
      // Save the friend locally too — next /send recognizes them by
      // name without the user having to paste the address again.
      try {
        contacts.save({ name: trimmedName, address: trimmedAddress });
      } catch {
        // saveContact validates internally; if it errors we still
        // want the on-chain success path to land.
      }
      queryClient.invalidateQueries({ queryKey: ["wallet-intents"] });
      queryClient.invalidateQueries({ queryKey: ["wallet", name] });
      toast.success(`${trimmedName} added to ${name}`);
      router.push(
        `/app/wallet/${encodeURIComponent(name)}/members`,
      );
    },
    onError: (err) => {
      console.error("[add-friend]", err);
      const msg =
        err instanceof BackendApiError
          ? err.message
          : err instanceof WalletSignError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Couldn't add this friend";
      const isNetwork =
        msg === "Failed to fetch" ||
        msg === "NetworkError when attempting to fetch resource.";
      if (isNetwork) {
        toast.error("Can't reach the server", {
          details:
            `Tried ${appConfig.backendApiUrl}. ` +
            "Start the backend with `cargo run -p clear-msig-backend-api`.",
          durationMs: 0,
        });
      } else {
        const details =
          err instanceof BackendApiError && err.payload
            ? JSON.stringify(err.payload, null, 2)
            : undefined;
        toast.error(msg, { details, durationMs: 0 });
      }
    },
  });

  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/app/wallet/${encodeURIComponent(name)}/members`}
        className={
          "-ml-2 inline-flex w-fit items-center gap-1.5 rounded-soft px-2 py-1 text-sm text-text-soft " +
          "transition-colors duration-base ease-out-soft hover:text-text-strong " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        }
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Members
      </Link>

      <motion.section
        {...motionProps}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
          <UserPlus className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <h1 className="mt-4 font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          Add a friend to {name}
        </h1>
        <p className="mt-2 max-w-md text-base text-text-soft">
          They&rsquo;ll be able to send requests and approve them.
          You&rsquo;ll need their Solana wallet address — ask them
          before you get started.
        </p>
      </motion.section>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) addFriend.mutate();
        }}
        className="flex flex-col gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest"
      >
        <FieldRow
          label="Name"
          value={friendName}
          onChange={setFriendName}
          placeholder="Sarah"
          autoFocus
          maxLength={40}
        />
        <div className="h-px bg-border-soft" />
        <FieldRow
          label="Address"
          value={friendAddress}
          onChange={setFriendAddress}
          placeholder="Solana wallet address"
          mono
        />
        {trimmedAddress.length > 0 && !addressValid && (
          <p className="ml-[4.5rem] text-xs text-warning">
            That doesn&rsquo;t look like a valid Solana address.
          </p>
        )}
        {addressValid && alreadyMember && (
          <p className="ml-[4.5rem] text-xs text-warning">
            This address is already a member of {name}.
          </p>
        )}
      </form>

      {addressValid && nameValid && !alreadyMember && (
        <ConfirmCard
          name={trimmedName}
          address={trimmedAddress}
          walletName={name}
          reduce={!!reduce}
        />
      )}

      <Button
        size="lg"
        fullWidth
        onClick={() => addFriend.mutate()}
        disabled={!canSubmit || addFriend.isPending}
      >
        {addFriend.isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Adding {trimmedName || "friend"}…
          </>
        ) : (
          <>
            Add {trimmedName || "friend"}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </>
        )}
      </Button>

      <p className="text-center text-xs text-text-soft">
        Your wallet will ask you to confirm. The change is signed and
        applied to {name}&rsquo;s on-chain rule.
      </p>
    </div>
  );
}

// ─── Field row ─────────────────────────────────────────────────────

interface FieldRowProps {
  label: string;
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
  mono?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
}

function FieldRow({
  label,
  value,
  onChange,
  placeholder,
  mono,
  autoFocus,
  maxLength,
}: FieldRowProps) {
  return (
    <label className="flex items-start gap-3">
      <span className="w-16 shrink-0 pt-2 text-xs font-medium uppercase tracking-wide text-text-soft">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        maxLength={maxLength}
        spellCheck={false}
        className={
          "flex-1 bg-transparent py-1.5 outline-none placeholder:text-text-soft/60 " +
          (mono
            ? "font-mono text-sm text-text-strong placeholder:font-sans"
            : "text-base text-text-strong")
        }
      />
    </label>
  );
}

// ─── Confirmation card ─────────────────────────────────────────────

function ConfirmCard({
  name,
  address,
  walletName,
  reduce,
}: {
  name: string;
  address: string;
  walletName: string;
  reduce: boolean;
}) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 } };
  return (
    <motion.div
      {...motionProps}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-card border border-accent/30 bg-accent/5 p-4"
    >
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-accent">
        About to add
      </p>
      <div className="mt-3 flex items-center gap-3">
        <MemberAvatar address={address} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text-strong">
            {name}
          </p>
          <p className="mt-0.5 truncate font-mono text-xs text-text-soft">
            {shortAddress(address)}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">
          <Check className="h-3 w-3" strokeWidth={3} />
          to {walletName}
        </span>
      </div>
    </motion.div>
  );
}
