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
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection, useWallet } from "@/lib/wallet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Loader2, Pencil, UserPlus, Users } from "lucide-react";
import { backendApi } from "@/lib/api/endpoints";
import { friendlyError } from "@/lib/api/errors";
import { encryptPolicyBatch } from "@/lib/encrypt/client";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { listProposalsForWallet } from "@/lib/chain/proposals";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import { IntentType, ProposalStatus } from "@/lib/msig";
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
import { sendOrganizationInvite } from "@/lib/organizations/client";
import { toDisplayName, toHeadingName } from "@/lib/retail/walletNames";
import { Breadcrumb } from "@/components/retail/Breadcrumb";
import { StickyTopBar } from "@/components/retail/StickyTopBar";
import { Button } from "@/components/retail/Button";
import { MemberAvatar } from "@/components/retail/MemberAvatar";
import { WalletPopupNarration } from "@/components/retail/WalletPopupNarration";
import { SignPayloadPreview } from "@/components/retail/SignPayloadPreview";
import { NextStepCard } from "@/components/retail/NextStepCard";
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
  const searchParams = useSearchParams();
  const wallet = useWallet();
  const { connection } = useConnection();
  const { signDescriptor } = useSignWithWallet();
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

  // We used to silently router.replace() to /setup when no spending
  // rule existed yet — that yanked the user mid-flow with no context.
  // Now we render an explanatory card below (see needsSetupCta) so
  // the user chooses to proceed.
  const needsSetup =
    !walletQuery.isLoading &&
    !intentsQuery.isLoading &&
    !!walletQuery.data &&
    firstIntent === null;

  // Initial values from URL params so the QuickAction input on
  // /app/wallet/[name] can route here with the form pre-filled.
  const [friendName, setFriendName] = useState(
    () => searchParams?.get("name")?.trim() ?? "",
  );
  const [friendAddress, setFriendAddress] = useState(
    () => searchParams?.get("address")?.trim() ?? "",
  );
  const [friendEmail, setFriendEmail] = useState(
    () => searchParams?.get("email")?.trim() ?? "",
  );
  /// Role drives both the on-chain intent update (which lists the
  /// friend lands in) and the local watchers store. Default "full"
  /// matches the previous behavior where every friend got both
  /// proposer + approver power.
  const [role, setRole] = useState<Role>(() => {
    const r = searchParams?.get("role")?.trim();
    return r === "approver" || r === "watcher" || r === "full" ? r : "full";
  });
  // Set on add-friend success so the page renders the NextStepCard
  // instead of routing straight to /members. Captured separately
  // from `friendName` so a half-typed name doesn't appear in the
  // success copy by accident.
  const [justAddedName, setJustAddedName] = useState<string | null>(null);

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

      // Resolve which signer pubkey the wallet's UpdateIntent
      // meta-intent (slot 2) expects. Adding a member calls
      // UpdateIntent on the spending rule, so the proposal/approval
      // signs against UpdateIntent's approver list — NOT the target
      // intent's. See setup/page.tsx for the full reasoning. The
      // watcher branch below skips the chain entirely so we only
      // need to gate when role !== "watcher".
      const updateIntent = (intentsQuery.data ?? []).find(
        (it) => it.account?.intentType === IntentType.UpdateIntent,
      );
      const signerPk =
        role !== "watcher" && updateIntent?.account
          ? wallet.pickSigner(updateIntent.account.approvers)
          : wallet.publicKey;
      if (role !== "watcher" && !signerPk) {
        throw new Error(
          "None of your connected wallets is in this wallet's approver list. " +
            "Disconnect the Ledger or sign in with the wallet that originally created this multisig.",
        );
      }

      // Recovery sweep: UpdateIntent on chain refuses if the target
      // intent has any active proposals (program error
      // `IntentHasActiveProposals` = 0x1780). A previous failed
      // execute could have left an Approved-but-not-Executed
      // proposal blocking us. Try to drain those before the update.
      // Execute is sponsored — no signature needed.
      if (walletQuery.data && (intent.activeProposalCount ?? 0) > 0) {
        const proposals = await listProposalsForWallet(
          connection,
          walletQuery.data.pda,
          walletQuery.data.account,
        );
        const stuck = proposals.filter(
          (p) =>
            p.intentIndex === intent.intentIndex &&
            p.account.status === ProposalStatus.Approved,
        );
        for (const p of stuck) {
          try {
            await backendApi.executeProposal(name, p.pda.toBase58(), {});
          } catch (sweepErr) {
            console.warn(
              `[add-friend] couldn't auto-execute stuck proposal ${p.pda.toBase58()}`,
              sweepErr,
            );
          }
        }
      }

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

      // 2. Sign — preferSigner routes through the matching
      //    Ledger/Dynamic pubkey resolved above.
      const signed = await signDescriptor(dry, { preferSigner: signerPk! });

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

      // 4. Approve, but only if propose didn't already land it
      //    Approved on chain (program auto-approves the proposer's
      //    bit when proposer ∈ approvers).
      const decision = await approveIfNeeded(connection, proposal);
      if (decision.needsApproveSignature) {
        const approveDry = await backendApi.prepare.approveProposal(
          name,
          proposal,
          { actor_pubkey: signerPk!.toBase58() },
        );
        const approveSigned = await signDescriptor(approveDry, {
          preferSigner: signerPk!,
        });
        await backendApi.submit.approveProposal(name, proposal, {
          ...approveSigned,
          expiry: approveDry.expiry,
        });
      }

      // 5. Execute: actually run UpdateIntent and swap the on-chain
      //    approver/proposer lists. No user signature needed.
      await backendApi.executeProposal(name, proposal, {});
      return submitted;
    },
    onSuccess: async (result) => {
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

      // Fire the actual invite email if the user supplied an address
      // AND the inviter wallet is connected. This is best-effort —
      // the on-chain change is already done; an email failure (SMTP
      // misconfig, throttling) shouldn't block the success toast.
      let emailDelivered = false;
      if (trimmedEmail && wallet.publicKey && role !== "watcher") {
        try {
          await sendOrganizationInvite({
            walletName: name,
            reason: "",
            inviterAddress: wallet.publicKey.toBase58(),
            invitee: { address: trimmedAddress, email: trimmedEmail },
          });
          emailDelivered = true;
        } catch (emailErr) {
          console.warn("[add-friend] email invite failed", emailErr);
        }
      }

      const roleLabel =
        role === "watcher"
          ? "as a watcher"
          : role === "approver"
            ? "as an approver"
            : "";
      const base = `${trimmedName} added to ${toDisplayName(name)}${roleLabel ? " " + roleLabel : ""}`;
      const message = !trimmedEmail
        ? base
        : emailDelivered
          ? `${base}. Invite emailed to ${trimmedEmail}`
          : `${base}. Couldn't reach ${trimmedEmail}; share the wallet link manually`;
      toast.success(message);
      // Don't router.push — let the success view show NextStepCard
      // so the user picks where to go (add another, set their limit,
      // back to members).
      setJustAddedName(trimmedName);
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
      <StickyTopBar offset="header">
        <Breadcrumb
          segments={[
            { label: "Wallets", href: "/app/wallet" },
            { label: toDisplayName(name), href: `/app/wallet/${encodeURIComponent(name)}` },
            {
              label: "Members",
              href: `/app/wallet/${encodeURIComponent(name)}/members`,
            },
            { label: "Add someone" },
          ]}
        />
      </StickyTopBar>

      <motion.section
        {...motionProps}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center text-center"
      >
        <h1 className="font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          Add someone to{" "}
          <span className="text-accent">{toHeadingName(name)}</span>
        </h1>
        <p className="mt-1.5 text-sm text-text-soft">
          You&rsquo;ll need their Solana wallet address.
        </p>
      </motion.section>

      {justAddedName && (
        <NextStepCard
          title={`${justAddedName} is in. What now?`}
          subtitle={`They can start ${role === "watcher" ? "watching" : "approving"} ${toDisplayName(name)} requests immediately.`}
          options={[
            {
              label: "Add another person",
              hint: "Reset the form and invite the next one.",
              onClick: () => {
                setFriendName("");
                setFriendAddress("");
                setFriendEmail("");
                setRole("full");
                setJustAddedName(null);
              },
              icon: UserPlus,
              primary: true,
            },
            {
              label: `Set ${justAddedName}'s spending limit`,
              hint: "Optional. Limits read on the inbox before approval.",
              href: `/app/wallet/${encodeURIComponent(name)}/allowances`,
              icon: Pencil,
            },
            {
              label: "Back to members",
              href: `/app/wallet/${encodeURIComponent(name)}/members`,
              icon: Users,
            },
          ]}
        />
      )}

      {/* Pre-flight gate: adding a member modifies the wallet's
          spending rule, which doesn't exist until setup-spending has
          run. Surface this explicitly with a clear next-step instead
          of silently kicking the user to /setup. */}
      {needsSetup && (
        <div className="rounded-card border border-warning/30 bg-warning/5 p-5 shadow-card-rest">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-warning">
            Set up sending first
          </p>
          <p className="mt-2 text-sm text-text-strong">
            Adding people changes <strong>{toDisplayName(name)}</strong>&rsquo;s
            spending rule, but no rule exists yet. Enable sending,
            then come back here. It&rsquo;s a 2-popup setup that takes
            about a minute.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href={`/app/wallet/${encodeURIComponent(name)}/setup`}
              className={
                "inline-flex items-center gap-1.5 rounded-soft bg-accent px-3.5 py-2 text-sm font-medium text-white shadow-accent-rest " +
                "transition-[background-color,transform] duration-base ease-out-soft " +
                "hover:bg-accent-hover active:scale-[0.98]"
              }
            >
              Enable sending
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
            <Link
              href={`/app/wallet/${encodeURIComponent(name)}`}
              className={
                "inline-flex items-center gap-1.5 rounded-soft border border-border-soft bg-surface-raised px-3.5 py-2 text-sm font-medium text-text-soft " +
                "transition-colors duration-base ease-out-soft hover:text-text-strong"
              }
            >
              Back to {toDisplayName(name)}
            </Link>
          </div>
        </div>
      )}

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
            This address is already a member of {toDisplayName(name)}. Pick &ldquo;Can
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

        {/* Role lives inline at the bottom of the form. Used to be a
            separate "What can they do?" card with three tile buttons —
            same choice, twice the surface area. Compact chip row keeps
            the decision on the page without competing with the inputs. */}
        <div className="h-px bg-border-soft" />
        <div className="flex items-center gap-3 pt-1">
          <span className="w-16 shrink-0 text-xs font-medium uppercase tracking-wide text-text-soft">
            Role
          </span>
          <div className="flex flex-1 flex-wrap gap-1.5">
            {(["full", "approver", "watcher"] as Role[]).map((r) => {
              const selected = role === r;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  aria-pressed={selected}
                  title={ROLE_HINT[r]}
                  className={
                    "rounded-full border px-3 py-1.5 text-xs font-medium " +
                    "transition-[border-color,background-color,color] duration-base ease-out-soft " +
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised " +
                    (selected
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border-soft bg-canvas text-text-soft hover:border-accent/40 hover:text-text-strong")
                  }
                >
                  {ROLE_LABEL[r]}
                </button>
              );
            })}
          </div>
        </div>
        <p className="ml-[4.5rem] text-[11px] leading-snug text-text-soft">
          {ROLE_HINT[role]}
        </p>
      </form>

      {/* Confirm + sign-preview reveal progressively, only after both
          fields are valid. Used to render with empty addresses + a
          "(paste above)" placeholder, which read as broken and added
          three early-paint blocks for no decision-making value. */}
      {nameValid && addressValid && (role === "watcher" || !alreadyMember) && (
        <ConfirmCard
          name={trimmedName}
          address={trimmedAddress}
          walletName={name}
          role={role}
          reduce={!!reduce}
        />
      )}

      {role !== "watcher" && nameValid && addressValid && (
        <div className="flex flex-col gap-3">
          <SignPayloadPreview
            action={`Add ${trimmedName} to ${toDisplayName(name)}`}
            details={[
              { label: "Wallet", value: toDisplayName(name) },
              {
                label: "Their role",
                value: role === "full" ? "Can spend & approve" : "Approves only",
              },
              {
                label: "Address",
                value: shortAddress(trimmedAddress),
                emphasis: "mono",
              },
              ...(trimmedEmail
                ? [{ label: "Invite email", value: trimmedEmail }]
                : []),
            ]}
          />
          <WalletPopupNarration
            action={`add ${trimmedName}`}
          />
        </div>
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
        {role === "watcher"
          ? "Watchers are saved on this device. No on-chain signature needed."
          : `The change is signed and applied to ${toDisplayName(name)}'s on-chain rule.`}
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

