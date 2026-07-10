"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import {
  AlertTriangle,
  ArrowLeft,
  Copy,
  Lock,
  Plug,
  RefreshCw,
  Send,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { importAgentInboxSignalsOnServer } from "@/features/agents/infrastructure/inboxClient";
import { submitAgentVenueExecution } from "@/features/agents/infrastructure/executionClient";
import { encryptStatus } from "@/lib/encrypt/client";
import { type AgentConnectionKit, type AgentPolicyEvaluation, type AgentProfile, type AgentProposalStatus, type AgentSignalInboxItem, type AgentTradeProposal, buildAgentTradeDecisionJournal, buildAgentTradeProposalFromSignal, canOpenLocalAgentExecution, evaluateAgentTradeProposal, parseAgentSignalJson, sampleAgentSignalPayload } from "@/features/agents/domain/runtime";
import { syncAgentExecution, syncAgentProposal } from "@/features/agents/infrastructure/stateClient";
import { agentRiskSnapshot, findAgent, getAgentConnectionKit, getAgentVaultPolicy, listAgentSessions, rotateAgentSignalKey, saveAgentProposal, saveAgentProposalAndExecuteIfAllowed, updateAgentConnectionSettings } from "@/features/agents/infrastructure/agentStore";
import { decryptAgentVaultPolicy, encryptAgentTradeProposal } from "@/features/agents/infrastructure/vaultCrypto";
import { toDisplayName } from "@/lib/retail/walletNames";

export default function AgentConnectionPage() {
  const params = useParams<{ name: string; agent: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const toast = useToast();
  const encrypt = encryptStatus();
  const [pending, startTransition] = useTransition();
  const name = useMemo(() => decodeParam(params?.name), [params?.name]);
  const agentId = useMemo(() => decodeParam(params?.agent), [params?.agent]);
  const encodedWallet = encodeURIComponent(name);
  const display = toDisplayName(name);
  const requestedVenue =
    search.get("venue") === "hyperliquid_testnet"
      ? "hyperliquid_testnet"
      : "mock_perps";
  const [agent, setAgent] = useState<AgentProfile | null>(null);
  const [kit, setKit] = useState<AgentConnectionKit | null>(null);
  const [signalJson, setSignalJson] = useState(() =>
    JSON.stringify(sampleAgentSignalPayload(), null, 2),
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState<AgentPolicyEvaluation | null>(null);
  const [origin, setOrigin] = useState("");
  const [inbox, setInbox] = useState<AgentSignalInboxItem[]>([]);
  const [inboxPreviews, setInboxPreviews] = useState<Record<string, AgentPolicyEvaluation>>({});
  const [registered, setRegistered] = useState(false);
  const [storageMode, setStorageMode] = useState<"redis" | "memory" | "unknown">("unknown");
  const [autoReviewRunning, setAutoReviewRunning] = useState(false);

  useEffect(() => {
    const found = findAgent(name, agentId);
    setAgent(found);
    setKit(found ? getAgentConnectionKit(name, agentId) : null);
  }, [agentId, name]);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const endpoint = `${origin}/api/agent-signals/${encodeURIComponent(name)}/${encodeURIComponent(agentId)}`;

  const registerConnection = useCallback(async (
    signalKey: string,
    managementKey: string,
    autoImportSessionSignals = false,
  ) => {
    const response = await fetch(apiPath(name, agentId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "register",
        signalKey,
        managementKey,
        autoImportSessionSignals,
      }),
    });
    if (!response.ok) {
      throw new Error(await errorText(response));
    }
    const body = (await response.json()) as { storage?: "redis" | "memory" };
    setStorageMode(body.storage ?? "unknown");
    setRegistered(true);
  }, [agentId, name]);

  const updateInboxPreviews = useCallback(async (items: AgentSignalInboxItem[]) => {
    const currentAgent = agent ?? findAgent(name, agentId);
    if (!currentAgent || items.length === 0) {
      setInboxPreviews({});
      return;
    }
    const now = Date.now();
    const policy = await decryptAgentVaultPolicy(getAgentVaultPolicy(name));
    const activeSession =
      listAgentSessions(name).find(
        (session) =>
          session.agentId === currentAgent.id &&
          session.status === "active" &&
          session.expiresAt > now,
      ) ?? null;
    const risk = agentRiskSnapshot(name, currentAgent.id);
    const next: Record<string, AgentPolicyEvaluation> = {};
    for (const item of items) {
      const proposal = buildAgentTradeProposalFromSignal({
        walletName: name,
        agent: currentAgent,
        signal: item.payload,
        now,
      });
      next[item.id] = evaluateAgentTradeProposal({
        agent: currentAgent,
        proposal,
        policy,
        session: activeSession,
        risk,
        now,
      });
    }
    setInboxPreviews(next);
  }, [agent, agentId, name]);

  const fetchInbox = useCallback(async (managementKey: string): Promise<AgentSignalInboxItem[]> => {
    const response = await fetch(apiPath(name, agentId), {
      method: "GET",
      headers: { "x-clearsig-management-key": managementKey },
    });
    if (!response.ok) {
      throw new Error(await errorText(response));
    }
    const body = (await response.json()) as {
      signals?: AgentSignalInboxItem[];
      storage?: "redis" | "memory";
    };
    setStorageMode(body.storage ?? "unknown");
    const signals = Array.isArray(body.signals) ? body.signals : [];
    setInbox(signals);
    await updateInboxPreviews(signals);
    return signals;
  }, [agentId, name, updateInboxPreviews]);

  useEffect(() => {
    if (!kit?.signalKey || !kit.managementKey) return;
    let cancelled = false;
    const run = async () => {
      try {
        await registerConnection(
          kit.signalKey,
          kit.managementKey,
          kit.autoImportSessionSignals,
        );
        if (!cancelled) await fetchInbox(kit.managementKey);
      } catch (err) {
        if (!cancelled) {
          setRegistered(false);
          toast.error("Could not prepare this connection", {
            details: err instanceof Error ? err.message : String(err),
          });
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [
    fetchInbox,
    kit?.autoImportSessionSignals,
    kit?.managementKey,
    kit?.signalKey,
    registerConnection,
    toast,
  ]);

  const buildDraftFromPayload = useCallback(async (
    payload: AgentSignalInboxItem["payload"],
    options: { updateFormErrors: boolean },
  ): Promise<{
    proposal: AgentTradeProposal;
    evaluation: AgentPolicyEvaluation;
    signal: AgentSignalInboxItem["payload"];
    agent: AgentProfile;
  } | null> => {
    const currentAgent = agent ?? findAgent(name, agentId);
    if (!currentAgent) {
      if (options.updateFormErrors) setErrors(["Trader not found."]);
      return null;
    }
    const now = Date.now();
    const proposal = buildAgentTradeProposalFromSignal({
      walletName: name,
      agent: currentAgent,
      signal: payload,
      now,
    });
    const policy = await decryptAgentVaultPolicy(getAgentVaultPolicy(name));
    const activeSession =
      listAgentSessions(name).find(
        (session) =>
          session.agentId === currentAgent.id &&
          session.status === "active" &&
          session.expiresAt > now,
      ) ?? null;
    const evaluation = evaluateAgentTradeProposal({
      agent: currentAgent,
      proposal,
      policy,
      session: activeSession,
      risk: agentRiskSnapshot(name, currentAgent.id),
      now,
    });
    if (options.updateFormErrors) setErrors([]);
    return { proposal, evaluation, signal: payload, agent: currentAgent };
  }, [agent, agentId, name]);

  const buildDraft = async (json = signalJson): Promise<{
    proposal: AgentTradeProposal;
    evaluation: AgentPolicyEvaluation;
    signal: AgentSignalInboxItem["payload"];
    agent: AgentProfile;
  } | null> => {
    const parsed = parseAgentSignalJson(json);
    if (!parsed.payload) {
      setErrors(parsed.errors);
      setPreview(null);
      return null;
    }
    return buildDraftFromPayload(parsed.payload, { updateFormErrors: true });
  };

  const persistInboxSignal = useCallback(async (
    proposal: AgentTradeProposal,
  ): Promise<AgentProposalStatus> => {
    if (proposal.status === "approved") {
      const result = saveAgentProposalAndExecuteIfAllowed(proposal);
      if (result.execution) {
        await syncAgentExecution(result.execution);
      }
      if (!canOpenLocalAgentExecution(result.proposal.venue)) {
        const placed = await submitAgentVenueExecution(result.proposal);
        if (!placed.ok) {
          throw new Error(
            `The idea was accepted, but the connected practice account could not place it. ${placed.message}`,
          );
        }
      }
      return result.proposal.status;
    }
    return saveAgentProposal(proposal).status;
  }, []);

  const checkRisk = () => {
    startTransition(async () => {
      const draft = await buildDraft();
      if (!draft) return;
      setPreview(draft.evaluation);
      toast.success(
        draft.evaluation.decision === "blocked"
          ? "This idea breaks your safety rules"
          : draft.evaluation.decision === "allowed"
            ? "This idea fits the current budget"
            : "This idea needs your approval",
      );
    });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startTransition(async () => {
      const draft = await buildDraft();
      if (!draft) return;
      const status = statusForDecision(draft.evaluation);
      const proposal: AgentTradeProposal = {
        ...draft.proposal,
        status,
        evaluationDecision: draft.evaluation.decision,
        policyViolations: draft.evaluation.violations,
        decisionJournal: buildAgentTradeDecisionJournal({
          agent: draft.agent,
          proposal: draft.proposal,
          evaluation: draft.evaluation,
          technicalSummary: draft.signal.technicalSummary,
          fundamentalSummary: draft.signal.fundamentalSummary,
          newsSummary: draft.signal.newsSummary,
          riskPlan: draft.signal.riskPlan,
          exitPlan: draft.signal.exitPlan,
          invalidation: draft.signal.invalidation,
        }),
        updatedAt: Date.now(),
      };
      try {
        const encrypted = await encryptAgentTradeProposal(proposal);
        if (status === "approved") {
          const result = saveAgentProposalAndExecuteIfAllowed(encrypted);
          const synced = await syncAgentProposal(result.proposal);
          if (result.execution) {
            await syncAgentExecution(result.execution);
          }
          if (synced.ok) {
            toast.success(
              result.execution
                ? "Idea accepted and practice trade opened"
                : "Idea accepted within the current budget",
            );
          } else {
            toast.info("Idea saved on this device for now", {
              details: synced.message,
            });
          }
        } else {
          const saved = saveAgentProposal(encrypted);
          const synced = await syncAgentProposal(saved);
          if (synced.ok) {
            toast.success(
              status === "blocked"
                ? "Idea saved, but stopped by your safety rules"
                : "Idea saved for your approval",
            );
          } else {
            toast.info("Idea saved on this device for now", {
              details: synced.message,
            });
          }
        }
        router.push(
          `/app/wallet/${encodedWallet}/agents/start?agent=${encodeURIComponent(agentId)}&venue=${requestedVenue}`,
        );
      } catch (err) {
        toast.error("Could not save idea", {
          details: err instanceof Error ? err.message : String(err),
        });
      }
    });
  };

  const rotateKey = () => {
    startTransition(async () => {
      const next = rotateAgentSignalKey(name, agentId);
      if (!next) {
        toast.error("Trader not found");
        return;
      }
      setKit(next);
      try {
        await registerConnection(
          next.signalKey,
          next.managementKey,
          next.autoImportSessionSignals,
        );
        toast.success("New send-only password is ready");
      } catch (err) {
        toast.error("The new password is saved here, but the connection is not ready", {
          details: err instanceof Error ? err.message : String(err),
        });
      }
    });
  };

  const refreshInbox = () => {
    startTransition(async () => {
      try {
        if (!kit?.managementKey) {
          throw new Error("The owner-only password is not ready.");
        }
        await fetchInbox(kit.managementKey);
        toast.success("Checked for new trade ideas");
      } catch (err) {
        toast.error("Could not check for new trade ideas", {
          details: err instanceof Error ? err.message : String(err),
        });
      }
    });
  };

  const importInboxSignal = (item: AgentSignalInboxItem) => {
    startTransition(async () => {
      try {
        if (!kit?.managementKey) {
          throw new Error("The owner-only password is not ready.");
        }
        const imported = await importAgentInboxSignalsOnServer({
          walletName: name,
          agentId,
          managementKey: kit.managementKey,
          ids: [item.id],
        });
        setStorageMode(imported.storage);
        const first = imported.imported[0];
        if (!first) {
          throw new Error(
            imported.skipped[0]?.reason || "This idea could not be reviewed.",
          );
        }
        const status = await persistInboxSignal(first.proposal);
        await fetchInbox(kit.managementKey);
        toast.success(
          status === "blocked"
            ? "The idea was stopped by your safety rules"
            : status === "approved" || status === "executed"
              ? "The idea was accepted"
              : "The idea is ready for your approval",
        );
      } catch (err) {
        toast.error("Could not review this idea", {
          details: err instanceof Error ? err.message : String(err),
        });
      }
    });
  };

  const runAutoReview = useCallback(async (): Promise<number> => {
    if (!kit?.managementKey || !kit.autoImportSessionSignals) return 0;
    setAutoReviewRunning(true);
    try {
      const items = await fetchInbox(kit.managementKey);
      const imported = await importAgentInboxSignalsOnServer({
        walletName: name,
        agentId,
        managementKey: kit.managementKey,
        ids: items.map((item) => item.id),
        allowedOnly: true,
      });
      setStorageMode(imported.storage);
      for (const item of imported.imported) {
        await persistInboxSignal(item.proposal);
      }
      if (imported.imported.length > 0) {
        await fetchInbox(kit.managementKey);
      }
      return imported.imported.length;
    } finally {
      setAutoReviewRunning(false);
    }
  }, [
    agentId,
    fetchInbox,
    kit?.autoImportSessionSignals,
    kit?.managementKey,
    name,
    persistInboxSignal,
  ]);

  useEffect(() => {
    if (!kit?.autoImportSessionSignals || !kit.managementKey || !registered) return;
    let cancelled = false;
    let active = false;
    const tick = async () => {
      if (cancelled || active) return;
      active = true;
      try {
        const imported = await runAutoReview();
        if (!cancelled && imported > 0) {
          toast.success(
            `${imported} new idea${imported === 1 ? "" : "s"} accepted within the current budget`,
          );
        }
      } catch (err) {
        if (!cancelled) {
          toast.error("Automatic checking paused", {
            details: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        active = false;
      }
    };
    tick();
    const id = window.setInterval(tick, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [kit?.autoImportSessionSignals, kit?.managementKey, registered, runAutoReview, toast]);

  const toggleAutoReview = (enabled: boolean) => {
    if (enabled) {
      toast.error("Use the trading desk to turn on automation", {
        details: "Automatic trading now requires a wallet-signed owner approval.",
      });
      router.push(
        `/app/wallet/${encodedWallet}/agents/start?agent=${encodeURIComponent(agentId)}&venue=${requestedVenue}`,
      );
      return;
    }
    startTransition(async () => {
      const updated = updateAgentConnectionSettings(name, agentId, {
        autoImportSessionSignals: enabled,
      });
      if (!updated) {
        toast.error("Trader connection not found");
        return;
      }
      setKit(updated);
      try {
        await registerConnection(
          updated.signalKey,
          updated.managementKey,
          updated.autoImportSessionSignals,
        );
        toast.success(enabled ? "Automatic trading is on" : "Automatic trading is off");
      } catch {
        toast.error("Could not change automatic trading");
      }
    });
  };

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error(`Could not copy ${label.toLowerCase()}`);
    }
  };

  if (!agent) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <Link
          href={`/app/wallet/${encodedWallet}/agents`}
          className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-text-soft transition-colors hover:text-accent"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Agent Trading
        </Link>
        <div className="rounded-card bg-surface-raised p-6 shadow-card-rest">
          <p className="text-sm font-semibold text-text-strong">Trader not found</p>
          <p className="mt-1 text-sm text-text-soft">
            This trader may have been removed.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Link
          href={`/app/wallet/${encodedWallet}/agents/start?agent=${encodeURIComponent(agentId)}`}
          className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-text-soft transition-colors hover:text-accent"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Start practice
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
              Connect Trader · {display}
            </p>
            <h1 className="mt-1 font-display text-lg leading-tight text-text-strong md:text-display-xs">
              Connect {agent.name}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-soft">
              Your trader can send ideas here, but it cannot move your money.
              ClearSig checks every idea against your rules before anything happens.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border-soft px-2.5 py-1 text-[11px] font-medium text-text-soft">
            <Lock className="h-3 w-3" aria-hidden="true" />
            {encrypt.live ? "Privacy on" : "Privacy ready"}
          </span>
        </div>
      </header>

      <section className="rounded-card bg-surface-raised p-5 shadow-card-rest sm:p-6">
        <div className="mb-5 flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Plug className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold text-text-strong">What your trader needs</p>
            <p className="mt-1 text-xs leading-relaxed text-text-soft">
              Share only these two items with your trader. They let it send ideas and nothing more.
            </p>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1fr_1.2fr]">
          <div className="grid gap-3">
            <InfoBox
              label="Send-to address"
              value={origin ? endpoint : "Loading address"}
              onCopy={() => origin && copyText(endpoint, "Send-to address")}
            />
            <InfoBox
              label="Send-only password"
              value={kit?.signalKey ?? "Loading"}
              onCopy={() => kit?.signalKey && copyText(kit.signalKey, "Send-only password")}
            />
            <button
              type="button"
              disabled={pending}
              onClick={rotateKey}
              className={SECONDARY_BUTTON_CLASS}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Make a new send-only password
            </button>
            <details className="rounded-soft border border-border-soft bg-canvas px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-text-soft">
                Owner-only details
              </summary>
              <div className="mt-3 grid gap-3">
                <InfoBox
                  label="Owner-only password"
                  value={kit?.managementKey ?? "Loading"}
                  onCopy={() => kit?.managementKey && copyText(kit.managementKey, "Owner-only password")}
                />
                <InfoBox
                  label="Trader number"
                  value={agentId}
                  onCopy={() => copyText(agentId, "Trader number")}
                />
                <p className="text-xs leading-relaxed text-text-soft">
                  Keep the owner-only password inside ClearSig. Never share it with your trader.
                </p>
              </div>
            </details>
          </div>
          <div className="rounded-soft border border-border-soft bg-canvas p-3">
            <p className="text-xs font-semibold text-text-strong">What happens next</p>
            <p className="mt-1 text-xs leading-relaxed text-text-soft">
              Give the send-to address and send-only password to your trader.
              New ideas will appear below. ClearSig checks each one against your
              trading style, max-loss rules, and current budget.
            </p>
            <span
              className={clsx(
                "mt-3 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium",
                registered
                  ? "border-accent/30 bg-accent/[0.08] text-accent"
                  : "border-warning/30 bg-warning/[0.08] text-warning",
              )}
            >
              {registered ? "Ready for ideas" : "Getting ready"}
            </span>
            <span className="ml-2 mt-3 inline-flex rounded-full border border-border-soft bg-surface-raised px-2 py-0.5 text-[11px] font-medium text-text-soft">
              {storageMode === "redis" ? "Ideas are saved" : "Saved on this device"}
            </span>
          </div>
        </div>
      </section>

      <section className="rounded-card bg-surface-raised p-5 shadow-card-rest sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-text-strong">New trade ideas</p>
            <p className="mt-1 text-xs leading-relaxed text-text-soft">
              Every idea is checked before it can become a practice trade.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex min-h-9 items-center gap-2 rounded-soft border border-border-soft bg-canvas px-3 py-2 text-xs font-medium text-text-strong">
              <input
                type="checkbox"
                aria-label="Trade automatically within budget"
                checked={kit?.autoImportSessionSignals ?? false}
                onChange={(event) => toggleAutoReview(event.target.checked)}
                className="h-3.5 w-3.5 accent-accent"
              />
              Trade automatically within budget
            </label>
            <button
              type="button"
              disabled={pending || autoReviewRunning}
              onClick={refreshInbox}
              className={SECONDARY_BUTTON_CLASS}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Check for new ideas
            </button>
          </div>
        </div>
        <div
          className={clsx(
            "mb-4 rounded-soft border px-3 py-2 text-xs leading-relaxed",
            kit?.autoImportSessionSignals
              ? "border-accent/25 bg-accent/[0.08] text-text-strong"
              : "border-border-soft bg-canvas text-text-soft",
          )}
        >
          {kit?.autoImportSessionSignals
            ? autoReviewRunning
              ? "Checking new ideas now. Only ideas inside your current budget can become trades."
              : "Automatic trading is on. ClearSig checks ideas as they arrive, even when this page is closed. Anything outside the budget waits for you."
            : "Automatic trading is off. New ideas stay here until you review them. Turn it on when you want this trader to act inside its budget."}
        </div>
        {inbox.length > 0 ? (
          <div className="grid gap-2">
            {inbox.map((item) => (
              <InboxSignalRow
                key={item.id}
                item={item}
                preview={inboxPreviews[item.id]}
                pending={pending}
                onImport={importInboxSignal}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-soft border border-dashed border-border-soft bg-canvas p-4 text-sm text-text-soft">
            No new trade ideas yet.
          </div>
        )}
      </section>

      <details className="rounded-card bg-surface-raised p-5 shadow-card-rest sm:p-6">
        <summary className="cursor-pointer text-sm font-semibold text-text-strong">
          Try a sample idea yourself
        </summary>
        <p className="mt-2 text-xs leading-relaxed text-text-soft">
          This is useful for a quick test before connecting your trader.
        </p>
        <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-text-soft">Idea details</span>
            <textarea
              aria-label="Trade idea details"
              value={signalJson}
              onChange={(event) => {
                setSignalJson(event.target.value);
                setPreview(null);
              }}
              rows={13}
              spellCheck={false}
              className={clsx(INPUT_CLASS, "font-mono text-xs leading-relaxed")}
            />
          </label>

          {errors.length > 0 ? <ErrorList errors={errors} /> : null}
          {preview ? <DecisionPreview preview={preview} /> : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-soft pt-4">
            <button
              type="button"
              className={SECONDARY_BUTTON_CLASS}
              onClick={() => setSignalJson(JSON.stringify(sampleAgentSignalPayload(), null, 2))}
              disabled={pending}
            >
              Load sample
            </button>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={checkRisk}
                className={SECONDARY_BUTTON_CLASS}
              >
                Check safety
              </button>
              <button type="submit" disabled={pending} className={BUTTON_CLASS}>
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                Save idea
              </button>
            </div>
          </div>
        </form>
      </details>
    </div>
  );
}

function InboxSignalRow({
  item,
  preview,
  pending,
  onImport,
}: {
  item: AgentSignalInboxItem;
  preview?: AgentPolicyEvaluation;
  pending: boolean;
  onImport: (item: AgentSignalInboxItem) => void;
}) {
  return (
    <div className="rounded-soft border border-border-soft bg-canvas p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-text-strong">
              {item.payload.market} · {item.payload.side}
            </p>
            <span className="rounded-full border border-border-soft px-1.5 py-0.5 text-[10px] font-medium text-text-soft">
              {item.payload.venue}
            </span>
            <RiskBadge preview={preview} />
          </div>
          <p className="mt-1 text-xs text-text-soft">
            ${item.payload.notionalUsd} · {item.payload.leverage}x · Arrived{" "}
            {new Date(item.receivedAt).toLocaleString()}
          </p>
          {item.payload.thesis ? (
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-text-soft">
              {item.payload.thesis}
            </p>
          ) : null}
          {preview?.violations[0] ? (
            <p className="mt-2 text-xs leading-relaxed text-rose-300">
              {preview.violations[0].message}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => onImport(item)}
          className={BUTTON_CLASS}
        >
          Review idea
        </button>
      </div>
    </div>
  );
}

function RiskBadge({ preview }: { preview?: AgentPolicyEvaluation }) {
  if (!preview) {
    return (
      <span className="rounded-full border border-border-soft bg-surface-raised px-1.5 py-0.5 text-[10px] font-medium text-text-soft">
        Checking
      </span>
    );
  }
  const tone =
    preview.decision === "blocked"
      ? "border-rose-500/30 bg-rose-500/[0.08] text-rose-300"
      : preview.decision === "allowed"
        ? "border-accent/30 bg-accent/[0.08] text-accent"
        : "border-warning/30 bg-warning/[0.08] text-warning";
  return (
    <span className={clsx("rounded-full border px-1.5 py-0.5 text-[10px] font-medium", tone)}>
      {preview.decision === "blocked"
        ? "Stopped"
        : preview.decision === "allowed"
          ? "Safe to try"
          : "Needs you"}
    </span>
  );
}

function InfoBox({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-soft border border-border-soft bg-canvas p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-text-soft">{label}</p>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex h-7 w-7 items-center justify-center rounded-soft border border-border-soft text-text-soft transition-colors hover:border-accent/60 hover:text-accent"
        >
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">Copy {label}</span>
        </button>
      </div>
      <p className="mt-2 break-all font-mono text-xs text-text-strong">{value}</p>
    </div>
  );
}

function ErrorList({ errors }: { errors: string[] }) {
  return (
    <div className="rounded-soft border border-rose-500/25 bg-rose-500/[0.08] p-3 text-xs text-rose-200">
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        This idea needs changes
      </div>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {errors.map((error) => (
          <li key={error}>{error}</li>
        ))}
      </ul>
    </div>
  );
}

function DecisionPreview({ preview }: { preview: AgentPolicyEvaluation }) {
  const blocked = preview.decision === "blocked";
  return (
    <div
      className={clsx(
        "rounded-soft border p-3 text-xs",
        blocked
          ? "border-rose-500/25 bg-rose-500/[0.08] text-rose-200"
          : "border-accent/25 bg-accent/[0.08] text-text-strong",
      )}
    >
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        {blocked
          ? "Stopped by your safety rules"
          : preview.decision === "allowed"
            ? "Fits the current budget"
            : "Ready for your approval"}
      </div>
      {preview.violations.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-text-soft">
          {preview.violations.map((violation) => (
            <li key={`${violation.code}:${violation.message}`}>
              {violation.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function statusForDecision(decision: AgentPolicyEvaluation): AgentProposalStatus {
  if (decision.decision === "blocked") return "blocked";
  if (decision.decision === "allowed") return "approved";
  return "needs_approval";
}

function decodeParam(value: string | undefined): string {
  const raw = value ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function apiPath(walletName: string, agentId: string): string {
  return `/api/agent-signals/${encodeURIComponent(walletName)}/${encodeURIComponent(agentId)}`;
}

async function errorText(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || response.statusText;
  } catch {
    return response.statusText;
  }
}

const INPUT_CLASS = clsx(
  "w-full rounded-soft border border-border-soft bg-canvas px-3 py-2 text-sm text-text-strong",
  "placeholder:text-text-muted",
  "transition-[border-color,box-shadow] duration-base ease-out-soft",
  "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25",
);

const BUTTON_CLASS = clsx(
  "inline-flex min-h-tap items-center justify-center gap-1.5 rounded-soft bg-accent px-4 py-2 text-xs font-medium text-text-on-accent shadow-accent-rest",
  "transition-[background-color,box-shadow,transform] duration-base ease-out-soft",
  "hover:bg-accent-hover hover:shadow-accent-hover active:scale-[0.98]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
  "disabled:cursor-not-allowed disabled:opacity-60",
);

const SECONDARY_BUTTON_CLASS = clsx(
  "inline-flex min-h-tap items-center justify-center gap-1.5 rounded-soft border border-border-soft bg-canvas px-4 py-2 text-xs font-medium text-text-strong",
  "transition-colors duration-base ease-out-soft hover:border-accent/60 hover:text-accent",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
  "disabled:cursor-not-allowed disabled:opacity-60",
);
