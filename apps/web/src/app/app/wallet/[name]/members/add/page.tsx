"use client";
import {
  selectSpendingIntent,
  ruleAuthorityCopy,
} from "@/lib/retail/setupChecklist";
import { templateFileForChainKind } from "@/lib/hooks/useUpdateTimelock";
import { savedProposalError } from "@/lib/clearsign/inlineApproval";

// Add a friend - real signed flow that grows the wallet's approver
// list. The user types a friend's name + Solana address; we save the
// pair locally to contacts AND run the on-chain update-intent flow
// (prepare → sign → submit) so the friend can sign requests under the selected spending rule. Governance is unchanged.
//
// Threshold isn't bumped automatically here - adding a friend keeps
// the existing X-of-Y count, just expands the Y. Changing approval
// thresholds is its own future flow.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection, useWallet } from "@/lib/wallet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  Loader2,
  Pencil,
  UserPlus,
  Users,
} from "lucide-react";
import { backendApi } from "@/lib/api/endpoints";
import { friendlyError } from "@/lib/api/errors";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { listProposalsForWallet } from "@/lib/chain/proposals";
import { useRequestIdentity } from "@/lib/hooks/useRequestIdentity";
import { completeTypedGovernance } from "@/lib/hooks/completeTypedGovernance";
import { clearSignProfileForSigner } from "@/lib/clearsign";
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
import { recordInvite } from "@/lib/security/inviteLog";
import { resolveWalletProductSurface } from "@/lib/productWorkspace";
import { toDisplayName } from "@/lib/retail/walletNames";
import { Button } from "@/components/retail/Button";
import { MemberAvatar } from "@/components/retail/MemberAvatar";
import { FormField, TextInput } from "@/components/retail/FormField";
import { SignPayloadPreview } from "@/components/retail/SignPayloadPreview";
import { NextStepCard } from "@/components/retail/NextStepCard";
import { useToast } from "@/components/ui/Toast";

// Same template the setup flow used. We're updating an existing
// intent's approvers, not changing the template, but the API needs
// the file path to round-trip the definition cleanly.

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
  const requestIdentity = useRequestIdentity();
  const { connection } = useConnection();
  const { signTypedDescriptor } = useSignWithWallet({
    scope: searchParams?.toString(),
  });
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

  const requestedIntent = searchParams?.get("intent") ?? null;
  const firstIntent = useMemo(
    () => selectSpendingIntent(intentsQuery.data ?? [], requestedIntent),
    [intentsQuery.data, requestedIntent],
  );
  const governance = (intentsQuery.data ?? []).find(
    (it) =>
      it.account?.approved && it.account.intentType === IntentType.UpdateIntent,
  )?.account;

  // We used to silently router.replace() to /setup when no spending
  // rule existed yet - that yanked the user mid-flow with no context.
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
  const requestedAddress = searchParams?.get("address")?.trim() ?? "";
  useEffect(() => {
    setFriendAddress(requestedAddress);
  }, [requestedAddress, requestedIntent]);
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
  const productSurface = resolveWalletProductSurface(name);
  const isPro = productSurface === "pro";
  const personFallback = isPro ? "team member" : "friend";
  const pageTitle = isPro ? "Add team member" : "Add a friend";
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
    (role === "watcher" || (!alreadyMember && !!governance)) &&
    !!firstIntent?.account;

  const addFriend = useMutation({
    mutationFn: async () => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first");
      const intent = firstIntent?.account;
      if (!intent) throw new Error("No spending rule on this wallet");

      // Resolve which signer pubkey the wallet's UpdateIntent
      // meta-intent (slot 2) expects. Adding a member calls
      // UpdateIntent on the spending rule, so the proposal/approval
      // signs against UpdateIntent's approver list - NOT the target
      // intent's. See setup/page.tsx for the full reasoning. The
      // watcher branch below skips the chain entirely so we only
      // need to gate when role !== "watcher".
      const updateIntent = (intentsQuery.data ?? []).find(
        (it) =>
          it.account?.approved &&
          it.account.intentType === IntentType.UpdateIntent,
      );
      if (role !== "watcher" && !updateIntent?.account)
        throw new Error("UpdateIntent governance authority is unavailable.");
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

      // Open proposals block authority rewrites; require explicit review instead of automatic execution.
      if (
        role !== "watcher" &&
        walletQuery.data &&
        (intent.activeProposalCount ?? 0) > 0
      ) {
        const proposals = await listProposalsForWallet(
          connection,
          walletQuery.data.pda,
          walletQuery.data.account,
        );
        const stuck = proposals.filter(
          (p) =>
            p.intentIndex === intent.intentIndex &&
            (p.account.status === ProposalStatus.Approved ||
              p.account.status === ProposalStatus.Active),
        );
        if (stuck.length)
          throw savedProposalError(
            stuck[0].pda.toBase58(),
            new Error(
              "This existing request blocks the authority change. Review and finish or cancel it explicitly; no existing request was executed automatically.",
            ),
          );
      }

      // Watchers don't touch the chain - they're a local "people who
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

      const voteIntent = updateIntent?.account ?? intent;
      const result = await completeTypedGovernance({
        requestIdentity: requestIdentity.capture(),
        connection,
        walletName: name,
        walletId: walletQuery.data?.pda.toBase58() ?? name,
        voteIntentIndex: voteIntent.intentIndex,
        voteApprovers: voteIntent.approvers,
        voteApprovalThreshold: voteIntent.approvalThreshold,
        targetIntentIndex: intent.intentIndex,
        expectedIntent: intent,
        proposers: newProposers,
        approvers: newApprovers,
        approvalThreshold: intent.approvalThreshold,
        cancellationThreshold: intent.cancellationThreshold,
        timelockSeconds: intent.timelockSeconds,
        templateFile: templateFileForChainKind(intent.chainKind),
        kind: "add_member",
        member: trimmedAddress,
        role: wantProposer ? "full" : "approver",
        proposerPk: signerPk!,
        signTypedDescriptor,
        pickApprover: (approvers) => wallet.pickSigner(approvers),
        deviceProfile: clearSignProfileForSigner(wallet, signerPk),
      });
      return {
        proposal: result.proposal,
        awaitingApprovals: result.kind === "awaiting_approvals",
      };
    },
    onSuccess: async (result) => {
      if ("awaitingApprovals" in result && result.awaitingApprovals) {
        toast.success(
          "Member request created; the member has not been added yet.",
        );
        router.push(`/app/proposals/${encodeURIComponent(result.proposal)}`);
        return;
      }
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
      // AND the inviter wallet is connected. This is best-effort -
      // the on-chain change is already done; an email failure (SMTP
      // misconfig, throttling) shouldn't block the success toast.
      let emailDelivered = false;
      if (trimmedEmail && wallet.publicKey) {
        try {
          await sendOrganizationInvite({
            walletName: name,
            reason: "",
            inviterAddress: wallet.publicKey.toBase58(),
            role,
            invitee: { address: trimmedAddress, email: trimmedEmail },
          });
          emailDelivered = true;
          // Audit trail for the inviter - surfaces in /app/invitations
          // and lets them send a withdrawal email if the invite was a
          // mistake. Only record when the SMTP send actually
          // succeeded; failures stay out of the log to avoid a
          // misleading "sent" entry.
          try {
            recordInvite({
              walletName: name,
              inviteeName: trimmedName,
              inviteeAddress: trimmedAddress,
              inviteeEmail: trimmedEmail,
              inviterAddress: wallet.publicKey.toBase58(),
              role,
            });
          } catch {
            /* log persist is best-effort */
          }
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
      // Don't router.push - let the success view show NextStepCard
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
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      {/* Compact left-aligned header - back navigation is in the
          DashboardHeader (desktop) / BottomNav (mobile). */}
      <motion.header
        {...motionProps}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
      >
        <div className="flex flex-col gap-1">
          <h1 className="hidden font-display text-display-xs leading-tight text-text-strong md:block">
            {pageTitle}
          </h1>
          <p className="text-xs text-text-soft sm:text-sm">
            Add {isPro ? "a person" : "someone"} to{" "}
            <span className="font-medium text-text-strong">
              {toDisplayName(name)}
            </span>
            .
          </p>
        </div>
      </motion.header>

      {justAddedName && (
        <NextStepCard
          title={`${justAddedName} is in. What now?`}
          subtitle={
            role === "watcher"
              ? "Saved as a local watcher; no signing authority was added."
              : `They can approve requests under spending rule #${firstIntent?.account?.intentIndex}. Other rules and governance are unchanged.`
          }
          options={[
            {
              label: isPro ? "Add another team member" : "Add another person",
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
              label: isPro ? "Back to team" : "Back to members",
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
      {firstIntent?.account && (
        <div className="rounded-card border border-border-soft p-4 text-sm text-text-soft">
          <p className="font-medium text-text-strong">
            Spending rule #{firstIntent.account.intentIndex}
          </p>
          <p>
            This adds authority only to the selected rule. Other spending rules
            and governance stay unchanged.
          </p>
          <p className="mt-2">
            {governance
              ? ruleAuthorityCopy(
                  governance,
                  walletQuery.data?.account.creator ?? "",
                )
              : "UpdateIntent authority unavailable; no change can be authorized."}
          </p>
        </div>
      )}
      {needsSetup && (
        <div className="rounded-card border border-warning/30 bg-warning/5 p-4 shadow-card-rest">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-warning">
            {requestedIntent !== null
              ? "Selected rule unavailable"
              : "Set up sending first"}
          </p>
          <p className="mt-2 text-sm text-text-strong">
            {requestedIntent !== null
              ? "The selected spending rule is not active or could not be found. Review the rules before adding anyone."
              : "Adding people requires an active spending rule. Set up sending first."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href={`/app/wallet/${encodeURIComponent(name)}/${requestedIntent !== null ? "rules" : "setup"}`}
              className={
                "inline-flex items-center gap-1.5 rounded-soft bg-accent px-3.5 py-2 text-sm font-medium text-text-on-accent shadow-accent-rest " +
                "transition-[background-color,transform] duration-base ease-out-soft " +
                "hover:bg-accent-hover active:scale-[0.98]"
              }
            >
              {requestedIntent !== null ? "Review rules" : "Enable sending"}
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
        className="flex flex-col gap-3 rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest sm:p-5"
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
          <p className="text-xs text-warning sm:ml-[4.5rem]">
            That doesn&rsquo;t look like a valid Solana address.
          </p>
        )}
        {addressValid && alreadyMember && role !== "watcher" && (
          <p className="text-xs text-warning sm:ml-[4.5rem]">
            This address is already a member of {toDisplayName(name)}. Pick
            &ldquo;Can watch&rdquo; if you want to keep them in the watchers
            list instead.
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
          <p className="text-xs text-warning sm:ml-[4.5rem]">
            That email looks malformed.
          </p>
        )}
        {emailValid && trimmedEmail.length > 0 && (
          <p className="text-xs text-text-soft sm:ml-[4.5rem]">
            We&rsquo;ll email {trimmedName || "them"} a join link.
          </p>
        )}

        {/* Role lives inline at the bottom of the form. Used to be a
            separate "What can they do?" card with three tile buttons -
            same choice, twice the surface area. Compact chip row keeps
            the decision on the page without competing with the inputs. */}
        <div className="h-px bg-border-soft" />
        <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:gap-3">
          <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-text-soft sm:w-16">
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
                    "inline-flex min-h-tap items-center justify-center rounded-full border px-4 py-2 text-xs font-medium " +
                    "transition-[border-color,background-color,color] duration-base ease-out-soft " +
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised " +
                    (selected
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border-soft bg-canvas text-text-soft hover:text-text-strong")
                  }
                >
                  {ROLE_LABEL[r]}
                </button>
              );
            })}
          </div>
        </div>
        <p className="text-xs leading-snug text-text-soft sm:ml-[4.5rem]">
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
                label: "Spending rule",
                value: `#${firstIntent?.account?.intentIndex ?? "unavailable"}`,
              },
              {
                label: "Change authority",
                value: governance
                  ? ruleAuthorityCopy(
                      governance,
                      walletQuery.data?.account.creator ?? "",
                    )
                  : "UpdateIntent authority unavailable; no change can be authorized.",
              },
              {
                label: "Their role",
                value:
                  role === "full" ? "Can spend & approve" : "Approves only",
              },
              {
                label: "Address",
                value: trimmedAddress,
                emphasis: "mono",
              },
              ...(trimmedEmail
                ? [{ label: "Invite email", value: trimmedEmail }]
                : []),
            ]}
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
            Adding {trimmedName || personFallback}…
          </>
        ) : (
          <>
            Add {trimmedName || personFallback}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </>
        )}
      </Button>

      <p className="text-center text-xs text-text-soft">
        {role === "watcher"
          ? "Watchers are saved on this device. No on-chain signature needed."
          : `Changes apply to spending rule #${firstIntent?.account?.intentIndex ?? "unavailable"} only, after governance approval and execution.`}
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
    <FormField
      label={optional ? `${label} (optional)` : label}
      className="sm:grid sm:grid-cols-[4rem_minmax(0,1fr)] sm:items-center sm:gap-3"
    >
      <TextInput
        type={inputType}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        maxLength={maxLength}
        spellCheck={false}
        className={mono ? "font-mono placeholder:font-sans" : "text-base"}
      />
    </FormField>
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
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">
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
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
          <Check className="h-3 w-3" strokeWidth={3} />
          {ROLE_LABEL[role]}
        </span>
      </div>
    </motion.div>
  );
}
