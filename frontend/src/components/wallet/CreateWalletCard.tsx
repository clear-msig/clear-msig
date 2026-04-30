"use client";

// "Initialize organization" wizard.
//
// Three-step form:
//   1. Name the multisig.
//   2. Capture a one-line purpose (included in invite emails).
//   3. Add signer addresses + emails, pick threshold, submit.
//
// On submit the form:
//   - Calls `backendApi.createWallet`. Bootstrapping a new wallet is
//     a one-shot, gasless operation for the user.
//   - Fires invite emails in parallel (non-blocking; per-invite
//     failures surface as warning toasts but do not block navigation).
//   - Toasts success + deep-links to /app/wallet/<name>.

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useWalletGate } from "@/lib/hooks/useWalletGate";
import { appConfig } from "@/lib/config";
import { backendApi } from "@/lib/api/endpoints";
import { BackendApiError } from "@/lib/api/client";
import { sendOrganizationInvite } from "@/lib/organizations/client";
import { CardShell } from "@/components/ui/CardShell";
import { useToast } from "@/components/ui/Toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  Loader2,
  Mail,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserPlus,
  Wallet,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

type SignerFormRow = {
  address: string;
  email: string;
};

const TOTAL_STEPS = 3;

export function CreateWalletCard() {
  const gate = useWalletGate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [walletName, setWalletName] = useState(appConfig.defaultWalletName);
  const [reason, setReason] = useState("");
  const [threshold, setThreshold] = useState("1");
  const [signers, setSigners] = useState<SignerFormRow[]>([{ address: "", email: "" }]);
  const [step, setStep] = useState(0);

  const steps = [
    { label: "Organization", Icon: Wallet },
    { label: "Purpose", Icon: Sparkles },
    { label: "Signers", Icon: ShieldCheck },
  ];

  const updateSigner = (index: number, key: keyof SignerFormRow, value: string) => {
    setSigners((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [key]: value } : row))
    );
  };

  const addSignerRow = () =>
    setSigners((prev) => [...prev, { address: "", email: "" }]);

  const removeSignerRow = (index: number) =>
    setSigners((prev) => prev.filter((_, i) => i !== index));

  /// Returns `null` when the current step is valid, or a short reason
  /// the user can act on. Surfaced under the Continue button — the old
  /// behaviour of silently disabling the button confused testers.
  const stepBlocker = (): string | null => {
    if (step === 0) {
      const trimmed = walletName.trim();
      if (trimmed.length === 0) return "Pick a name for the organization";
      if (trimmed.length > 64) return "Name must be 64 characters or fewer";
      if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
        return "Name can only use letters, digits, '-' or '_'";
      }
      return null;
    }
    if (step === 1) {
      if (reason.trim().length === 0) return "Add a one-line reason for the invite email";
      return null;
    }
    return null;
  };
  const canGoNext = () => stepBlocker() === null;

  // Step-2 (signers + threshold) validation. Computed every render so
  // the submit button + summary pill react live to edits.
  const submitSummary = useMemo(() => {
    const partialRows = signers.map((r, i) => ({
      i,
      address: r.address.trim(),
      email: r.email.trim().toLowerCase(),
    }));
    const filledRows = partialRows.filter((r) => r.address || r.email);
    const connectedAddress = gate.publicKey?.trim() ?? "";
    const allAddresses = [
      ...(connectedAddress ? [connectedAddress] : []),
      ...filledRows.map((r) => r.address),
    ].filter(Boolean);
    const uniqueAddresses = Array.from(new Set(allAddresses));
    const parsedThreshold = Number(threshold);

    let blocker: string | null = null;
    if (!gate.connected || !connectedAddress) {
      blocker = "Connect a Solana wallet to create an organization";
    } else {
      for (const r of partialRows) {
        if (!r.address && !r.email) continue;
        if (!r.address) {
          blocker = `Signer ${r.i + 1}: address is required`;
          break;
        }
        if (!isValidSolanaAddress(r.address)) {
          blocker = `Signer ${r.i + 1}: not a valid Solana address`;
          break;
        }
        if (!r.email) {
          blocker = `Signer ${r.i + 1}: email is required for the invite`;
          break;
        }
        if (!isValidEmail(r.email)) {
          blocker = `Signer ${r.i + 1}: email looks malformed`;
          break;
        }
      }
      if (!blocker && allAddresses.length !== uniqueAddresses.length) {
        blocker = "Two signers share the same address";
      }
      if (!blocker && (!Number.isInteger(parsedThreshold) || parsedThreshold < 1)) {
        blocker = "Threshold must be at least 1";
      }
      if (!blocker && parsedThreshold > uniqueAddresses.length) {
        blocker = `Threshold cannot exceed ${uniqueAddresses.length} signer${
          uniqueAddresses.length === 1 ? "" : "s"
        }`;
      }
    }

    return {
      blocker,
      threshold: parsedThreshold,
      signerCount: uniqueAddresses.length,
      addedCount: filledRows.length,
    };
  }, [signers, gate.connected, gate.publicKey, threshold]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!gate.publicKey) {
        throw new Error("Connect a wallet before creating an organization");
      }
      const connectedAddress = gate.publicKey.trim();
      const prepared = signers
        .map((row) => ({ address: row.address.trim(), email: row.email.trim().toLowerCase() }))
        .filter((row) => row.address.length > 0);

      if (prepared.some((row) => row.email.length === 0)) {
        throw new Error("Each signer needs an email for the invite");
      }

      const uniqueApprovers = Array.from(
        new Set([connectedAddress, ...prepared.map((row) => row.address)])
      );
      const parsedThreshold = Number(threshold);
      if (!Number.isInteger(parsedThreshold) || parsedThreshold < 1) {
        throw new Error("Threshold must be at least 1");
      }
      if (parsedThreshold > uniqueApprovers.length) {
        throw new Error("Threshold cannot exceed signer count");
      }

      const result = await backendApi.createWallet({
        name: walletName,
        proposers: uniqueApprovers,
        approvers: uniqueApprovers,
        threshold: parsedThreshold,
        cancellation_threshold: parsedThreshold,
        timelock: 0,
      });

      // Fire invite emails in parallel. Failures are non-fatal and
      // surface as a secondary toast so the user knows which signers
      // still need to be informed manually.
      if (prepared.length > 0) {
        const inviteResults = await Promise.allSettled(
          prepared.map((signer) =>
            sendOrganizationInvite({
              walletName,
              reason: reason.trim(),
              inviterAddress: connectedAddress,
              invitee: signer,
            })
          )
        );
        const failed = inviteResults
          .map((r, i) => (r.status === "rejected" ? prepared[i].email : null))
          .filter((e): e is string => Boolean(e));
        if (failed.length > 0) {
          toast.info(
            `Wallet created, but ${failed.length} invite email(s) failed to send`,
            {
              details: `Failed recipients: ${failed.join(", ")}. Share the URL /app/wallet/${walletName} manually.`,
            }
          );
        }
      }

      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["wallet", walletName] });
      queryClient.invalidateQueries({ queryKey: ["wallet-chains", walletName] });
      queryClient.invalidateQueries({ queryKey: ["my-organizations"] });
      toast.success(`Organization "${walletName}" is live`, {
        link: explorerLink(result),
        details: "Heading to the wallet dashboard. Configure chain bindings from there.",
      });
      router.push(`/app/wallet/${encodeURIComponent(walletName)}`);
    },
    onError: (err) => {
      if (err instanceof BackendApiError) {
        toast.error(err.message, {
          details: err.payload ? JSON.stringify(err.payload, null, 2) : undefined,
        });
      } else {
        toast.error(err instanceof Error ? err.message : "Could not create organization");
      }
    },
  });

  return (
    <CardShell
      title="Initialize Organization"
      subtitle="Create a cross-chain multisig. One signature, any chain."
    >
      <div className="flex flex-col gap-5">
        <Stepper step={step} steps={steps} />

        <div className="relative overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            {step === 0 && (
              <motion.div
                key="step-0"
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.2 }}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
              >
                <Heading Icon={Wallet}>Pick a memorable name</Heading>
                <p className="mt-1 text-xs text-text-muted">
                  Wallet names are unique on chain and show up in the signing
                  preview. Keep them human-readable.
                </p>
                <input
                  value={walletName}
                  onChange={(e) => setWalletName(e.target.value)}
                  autoFocus
                  placeholder="treasury"
                  spellCheck={false}
                  className="mt-4 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-mono text-brand-white placeholder:text-white/20 outline-none transition-colors focus:border-brand-green/50 focus:bg-white/10"
                />
              </motion.div>
            )}

            {step === 1 && (
              <motion.div
                key="step-1"
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.2 }}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
              >
                <Heading Icon={Sparkles}>Why this multisig exists</Heading>
                <p className="mt-1 text-xs text-text-muted">
                  Shown to signers in the invite email so they know what
                  they're joining.
                </p>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  autoFocus
                  placeholder="Treasury governance for Clear Protocol operations"
                  className="mt-4 min-h-28 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-brand-white placeholder:text-white/20 outline-none transition-colors focus:border-brand-green/50 focus:bg-white/10"
                />
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="step-2"
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.2 }}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <Summary label="Organization" value={walletName} />
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
                      Approval threshold
                    </span>
                    <input
                      value={threshold}
                      onChange={(e) =>
                        setThreshold(e.target.value.replace(/[^\d]/g, ""))
                      }
                      inputMode="numeric"
                      className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-brand-white outline-none transition-colors focus:border-brand-green/50 focus:bg-white/10"
                    />
                  </label>
                </div>

                <div className="mt-5">
                  <Heading Icon={UserPlus}>Signers</Heading>
                  <p className="mt-1 text-xs text-text-muted">
                    You're the first approver automatically. Invite teammates
                    by adding their Solana address + email below.
                  </p>

                  <div className="mt-3 flex flex-col gap-2">
                    {signers.map((row, i) => (
                      <motion.div
                        key={i}
                        layout
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
                      >
                        <input
                          value={row.address}
                          onChange={(e) => updateSigner(i, "address", e.target.value)}
                          placeholder="Wallet address"
                          spellCheck={false}
                          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 font-mono text-xs text-brand-white outline-none transition-colors focus:border-brand-green/50 focus:bg-white/10"
                        />
                        <div className="relative">
                          <Mail
                            size={12}
                            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30"
                          />
                          <input
                            value={row.email}
                            onChange={(e) => updateSigner(i, "email", e.target.value)}
                            placeholder="teammate@company.com"
                            spellCheck={false}
                            className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-8 pr-3 text-sm text-brand-white outline-none transition-colors focus:border-brand-green/50 focus:bg-white/10"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeSignerRow(i)}
                          disabled={signers.length === 1}
                          aria-label="Remove signer"
                          className="flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-3 text-white/60 transition-colors hover:border-rose-400/40 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Trash2 size={14} />
                        </button>
                      </motion.div>
                    ))}
                    <button
                      type="button"
                      onClick={addSignerRow}
                      className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/15 bg-transparent px-4 py-2.5 text-xs font-semibold text-white/60 transition-colors hover:border-brand-green/50 hover:text-brand-green"
                    >
                      <UserPlus size={12} /> Add another signer
                    </button>
                  </div>
                </div>

                <div className="mt-5 flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs">
                  <div className="flex items-center justify-between gap-2 text-brand-white">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <ShieldCheck size={12} className="text-brand-green" />
                      Final policy
                    </span>
                    <span className="font-mono text-brand-green">
                      {submitSummary.threshold || "·"}-of-{submitSummary.signerCount}
                    </span>
                  </div>
                  <div className="text-text-muted">
                    {submitSummary.signerCount === 1
                      ? "Just you — every transaction will execute on a single signature."
                      : `You + ${submitSummary.addedCount} invited signer${
                          submitSummary.addedCount === 1 ? "" : "s"
                        }, requiring ${submitSummary.threshold} approval${
                          submitSummary.threshold === 1 ? "" : "s"
                        } per transaction.`}
                  </div>
                </div>

                <button
                  disabled={
                    submitSummary.blocker !== null || mutation.isPending
                  }
                  onClick={() => mutation.mutate()}
                  className="group mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-green px-5 py-3.5 text-sm font-bold text-black shadow-glow transition-all hover:bg-emerald-300 hover:shadow-glow-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {mutation.isPending ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Deploying…
                    </>
                  ) : (
                    <>
                      <ShieldCheck size={16} />
                      Create organization
                      <ArrowRight
                        size={16}
                        className="transition-transform group-hover:translate-x-0.5"
                      />
                    </>
                  )}
                </button>
                {submitSummary.blocker && (
                  <p className="mt-2 text-center text-xs text-amber-300">
                    {submitSummary.blocker}
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {step < TOTAL_STEPS - 1 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep((prev) => Math.max(0, prev - 1))}
                disabled={step === 0}
                className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-brand-white transition-colors hover:border-brand-green/40 disabled:opacity-40"
              >
                <ChevronLeft size={12} /> Back
              </button>
              <button
                type="button"
                onClick={() => setStep((prev) => Math.min(TOTAL_STEPS - 1, prev + 1))}
                disabled={!canGoNext()}
                className="group inline-flex items-center gap-1 rounded-xl bg-brand-green px-4 py-2 text-xs font-bold text-black transition-all hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Continue
                <ArrowRight
                  size={12}
                  className="transition-transform group-hover:translate-x-0.5"
                />
              </button>
            </div>
            {stepBlocker() && (
              <p className="self-end text-right text-[11px] text-amber-300">
                {stepBlocker()}
              </p>
            )}
          </div>
        )}
      </div>
    </CardShell>
  );
}

function Stepper({
  step,
  steps,
}: {
  step: number;
  steps: { label: string; Icon: typeof Wallet }[];
}) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto">
      {steps.map((s, i) => {
        const active = i <= step;
        const complete = i < step;
        const Icon = complete ? Check : s.Icon;
        return (
          <div key={s.label} className="flex items-center gap-2">
            <motion.div
              initial={false}
              animate={{ scale: i === step ? 1.05 : 1 }}
              className={[
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors",
                active
                  ? "border-brand-green/40 bg-brand-green/15 text-brand-green"
                  : "border-white/10 bg-white/5 text-white/40",
              ].join(" ")}
            >
              <Icon size={11} />
              <span className="hidden sm:inline">{s.label}</span>
            </motion.div>
            {i < steps.length - 1 && (
              <div
                className={`h-px w-6 transition-colors ${
                  i < step ? "bg-brand-green/40" : "bg-white/10"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Heading({ Icon, children }: { Icon: typeof Wallet; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold text-brand-white">
      <span className="rounded-md bg-brand-green/20 p-1 text-brand-green">
        <Icon size={12} />
      </span>
      {children}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
        {label}
      </span>
      <span className="flex items-center gap-1.5 text-sm font-semibold text-brand-white">
        <CheckCircle2 size={12} className="text-brand-green" />
        {value || "·"}
      </span>
    </div>
  );
}

function explorerLink(
  res: Record<string, unknown>
): { label: string; href: string } | undefined {
  const txid = res.txid as string | undefined;
  if (!txid) return undefined;
  return {
    label: `tx ${txid.slice(0, 8)}…`,
    href: `https://explorer.solana.com/tx/${txid}?cluster=devnet`,
  };
}

function isValidSolanaAddress(s: string): boolean {
  try {
    new PublicKey(s);
    return true;
  } catch {
    return false;
  }
}

function isValidEmail(s: string): boolean {
  // Light format check; the auth server will do real validation. We
  // just want to catch obvious typos before submit.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
