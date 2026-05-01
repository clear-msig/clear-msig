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
import { friendlyError } from "@/lib/api/errors";
import { encryptPolicyBatch } from "@/lib/encrypt/client";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { fromHex, IntentType } from "@/lib/msig";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { useContacts } from "@/lib/hooks/useContacts";
import {
  isValidEmail,
  isValidSolanaAddress,
  shortAddress,
} from "@/lib/retail/contacts";
import {
  addWatcher,
  ROLE_HINT,
  ROLE_LABEL,
  type Role,
} from "@/lib/retail/roles";
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
      const upTo = walletQuery.data.account.intentIndex;
      return listIntents(connection, walletQuery.data.pda, upTo);
    },
    enabled: !!walletQuery.data,
    staleTime: 30_000,
  });

  const firstIntent = useMemo(() => {
    if (!intentsQuery.data) return null;
    // Skip bootstrap intents (slots 0/1/2 are AddIntent/RemoveIntent/
    // UpdateIntent). The user's spending rule is the first Custom.
    return (
      intentsQuery.data.find(
        (it) => it.account !== null && it.account.intentType === IntentType.Custom,
      ) ?? null
    );
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
  const [friendEmail, setFriendEmail] = useState("");
  /// Role drives both the on-chain intent update (which lists the
  /// friend lands in) and the local watchers store. Default "full"
  /// matches the previous behavior where every friend got both
  /// proposer + approver power.
  const [role, setRole] = useState<Role>("full");

  const trimmedName = friendName.trim();
  const trimmedAddress = friendAddress.trim();
  const trimmedEmail = friendEmail.trim();
  const nameValid = trimmedName.length >= 2;
  const addressValid = isValidSolanaAddress(trimmedAddress);
  const emailValid = trimmedEmail.length === 0 || isValidEmail(trimmedEmail);
  const alreadyMember =
    firstIntent?.account?.approvers.includes(trimmedAddress) ?? false;
  // Watchers never touch the chain, so the "already in approvers" gate
  // shouldn't block adding someone to the local watch list. The
  // localStorage layer dedupes by address itself.
  const canSubmit =
    nameValid &&
    addressValid &&
    emailValid &&
    (role === "watcher" || !alreadyMember) &&
    !!firstIntent?.account;

  const addFriend = useMutation({
    mutationFn: async () => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first");
      const intent = firstIntent?.account;
      if (!intent) throw new Error("No spending rule on this wallet");

      // Watchers don't touch the chain — they're a local "people who
      // can read this wallet's activity" pin. Save to the watchers
      // store and exit early before any signed write.
      if (role === "watcher") {
        addWatcher({
          walletName: name,
          address: trimmedAddress,
          name: trimmedName,
        });
        contacts.save({
          name: trimmedName,
          address: trimmedAddress,
          email: trimmedEmail || undefined,
        });
        return { watcher: true } as const;
      }

      const newApprovers = intent.approvers.includes(trimmedAddress)
        ? [...intent.approvers]
        : [...intent.approvers, trimmedAddress];
      // Role decides whether the friend can also create requests.
      // "full" = proposer + approver. "approver" = approver only.
      const wantProposer = role === "full";
      const newProposers = wantProposer
        ? intent.proposers.includes(trimmedAddress)
          ? [...intent.proposers]
          : [...intent.proposers, trimmedAddress]
        : [...intent.proposers];

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

      // 3. Submit propose: lands the UpdateIntent proposal in Active
      //    state. The propose call does NOT count as an approval —
      //    we have to flip the bit explicitly with a second sign.
      const submitted = await backendApi.submit.updateIntent(name, {
        ...signed,
        params_data_hex: dry.params_data_hex,
        expiry: dry.expiry,
        index: intent.intentIndex,
        file: TEMPLATE_FILE,
      });

      const proposal = (submitted as Record<string, unknown>)?.proposal;
      if (typeof proposal !== "string" || proposal.length === 0) {
        throw new Error(
          "Backend didn't return a proposal address from the propose step",
        );
      }

      // 4. Approve: second wallet popup. With threshold=1 this flips
      //    the proposal from Active → Approved.
      const approveDry = await backendApi.prepare.approveProposal(
        name,
        proposal,
        { actor_pubkey: wallet.publicKey.toBase58() },
      );
      const approveSigned = await signBytes(fromHex(approveDry.message_hex));
      await backendApi.submit.approveProposal(name, proposal, {
        ...approveSigned,
        expiry: approveDry.expiry,
      });

      // 5. Execute: actually run UpdateIntent and swap the on-chain
      //    approver/proposer lists. No user signature needed.
      await backendApi.executeProposal(name, proposal, {});
      return submitted;
    },
    onSuccess: (result) => {
      // Watcher path saves to contacts inline above; chain path saves
      // here so the on-chain success is the gate.
      if (!(result as { watcher?: boolean })?.watcher) {
        try {
          contacts.save({
            name: trimmedName,
            address: trimmedAddress,
            email: trimmedEmail || undefined,
          });
        } catch {
          // saveContact validates internally; if it errors we still
          // want the on-chain success path to land.
        }
      }
      queryClient.invalidateQueries({ queryKey: ["wallet-intents"] });
      queryClient.invalidateQueries({ queryKey: ["wallet", name] });
      const roleLabel =
        role === "watcher"
          ? "as a watcher"
          : role === "approver"
            ? "as an approver"
            : "";
      const base = `${trimmedName} added to ${name}${roleLabel ? " " + roleLabel : ""}`;
      const message = trimmedEmail
        ? `${base} — we'll email ${trimmedEmail}`
        : base;
      toast.success(message);
      router.push(
        `/app/wallet/${encodeURIComponent(name)}/members`,
      );
    },
    onError: (err) => {
      console.error("[add-friend]", err);
      const fe = friendlyError(err, "add-friend");
      toast.error(fe.title, { details: fe.body });
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
        className="flex flex-col items-center text-center"
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
          maxLength={64}
        />
        {trimmedAddress.length > 0 && !addressValid && (
          <p className="ml-[4.5rem] text-xs text-warning">
            That doesn&rsquo;t look like a valid Solana address.
          </p>
        )}
        {addressValid && alreadyMember && role !== "watcher" && (
          <p className="ml-[4.5rem] text-xs text-warning">
            This address is already a member of {name}. Pick &ldquo;Can
            watch&rdquo; if you want to keep them in the watchers list
            instead.
          </p>
        )}
        <div className="h-px bg-border-soft" />
        <FieldRow
          label="Email"
          optional
          value={friendEmail}
          onChange={setFriendEmail}
          placeholder="sarah@example.com"
          inputType="email"
          maxLength={120}
        />
        {trimmedEmail.length > 0 && !emailValid && (
          <p className="ml-[4.5rem] text-xs text-warning">
            That email looks malformed.
          </p>
        )}
        {emailValid && trimmedEmail.length > 0 && (
          <p className="ml-[4.5rem] text-xs text-text-soft">
            We&rsquo;ll email {trimmedName || "them"} a join link so they
            can sign in.
          </p>
        )}
      </form>

      <div className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
          What can they do?
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(["full", "approver", "watcher"] as Role[]).map((r) => (
            <RoleTile
              key={r}
              role={r}
              selected={role === r}
              onSelect={() => setRole(r)}
            />
          ))}
        </div>
      </div>

      {addressValid && nameValid && (role === "watcher" || !alreadyMember) && (
        <ConfirmCard
          name={trimmedName}
          address={trimmedAddress}
          walletName={name}
          role={role}
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
  optional?: boolean;
  inputType?: "text" | "email";
}

function FieldRow({
  label,
  value,
  onChange,
  placeholder,
  mono,
  autoFocus,
  maxLength,
  optional,
  inputType = "text",
}: FieldRowProps) {
  return (
    <label className="flex items-start gap-3">
      <span className="w-16 shrink-0 pt-2 text-xs font-medium uppercase tracking-wide text-text-soft">
        {label}
        {optional && (
          <span className="ml-1 normal-case tracking-normal text-text-soft/60">
            (opt)
          </span>
        )}
      </span>
      <input
        type={inputType}
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
  role,
  reduce,
}: {
  name: string;
  address: string;
  walletName: string;
  role: Role;
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
          {ROLE_LABEL[role]}
        </span>
      </div>
    </motion.div>
  );
}

// ─── Role tile ─────────────────────────────────────────────────────

function RoleTile({
  role,
  selected,
  onSelect,
}: {
  role: Role;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={
        "flex flex-col items-start gap-1 rounded-card border p-3 text-left " +
        "transition-[border-color,background-color,box-shadow] duration-base ease-out-soft " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised " +
        (selected
          ? "border-accent bg-accent/5 shadow-card-rest"
          : "border-border-soft bg-canvas hover:border-accent/40")
      }
    >
      <p className="text-sm font-medium text-text-strong">
        {ROLE_LABEL[role]}
      </p>
      <p className="text-[11px] leading-snug text-text-soft">
        {ROLE_HINT[role]}
      </p>
    </button>
  );
}
