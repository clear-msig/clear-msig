"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import clsx from "clsx";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Bot, Lock, Save } from "lucide-react";
import { encryptStatus } from "@/lib/encrypt/client";
import {
  encryptAgentProfile,
  newAgentId,
  saveAgent,
  syncAgentProfile,
  type AgentKind,
  type AgentProfile,
} from "@/lib/agents";
import { toDisplayName } from "@/lib/retail/walletNames";
import { useToast } from "@/components/ui/Toast";

const AGENT_KINDS: Array<{ value: AgentKind; label: string }> = [
  { value: "mock", label: "Internal sandbox trader" },
  { value: "api", label: "Connected trader" },
  { value: "hermes", label: "Independent trader" },
  { value: "manual", label: "Person" },
];

export default function NewAgentPage() {
  const params = useParams<{ name: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const toast = useToast();
  const encrypt = encryptStatus();
  const [pending, startTransition] = useTransition();
  const name = useMemo(() => {
    const raw = params?.name ?? "";
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }, [params?.name]);
  const display = toDisplayName(name);
  const encoded = encodeURIComponent(name);
  const advanced = search.get("mode") === "advanced";

  const [agentName, setAgentName] = useState("");
  const [kind, setKind] = useState<AgentKind>(advanced ? "api" : "mock");
  const [identityPubkey, setIdentityPubkey] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [description, setDescription] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startTransition(async () => {
      const cleanName = agentName.trim();
      if (!cleanName) {
        toast.error("Give your trader a name");
        return;
      }
      const now = Date.now();
      const draft: AgentProfile = {
        id: newAgentId(),
        walletName: name,
        name: cleanName,
        kind,
        status: "active",
        identityPubkey: identityPubkey.trim() || undefined,
        endpoint: endpoint.trim() || undefined,
        description: description.trim() || undefined,
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      try {
        const encrypted = await encryptAgentProfile(draft);
        saveAgent(encrypted);
        const synced = await syncAgentProfile(encrypted);
        if (synced.ok) {
          toast.success(`${cleanName} added`);
        } else {
          toast.info("Your trader is saved on this device for now", {
            details: synced.message,
          });
        }
        router.push(
          `/app/wallet/${encodeURIComponent(name)}/agents/${encodeURIComponent(draft.id)}/strategy`,
        );
      } catch (err) {
        toast.error("Could not add trader", {
          details: err instanceof Error ? err.message : String(err),
        });
      }
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Link
          href={`/app/wallet/${encoded}/agents/library`}
          className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-text-soft transition-colors hover:text-accent"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Agent Library
        </Link>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
            Trader Profile · {display}
          </p>
          <h1 className="font-display text-lg leading-tight text-text-strong md:text-display-xs">
            {advanced ? "Connect an outside trader" : "Create your own trader"}
          </h1>
        </div>
      </header>

      <section className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest sm:p-6">
        <div className="mb-5 flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Bot className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
          </span>
          <div>
            <p className="text-sm font-semibold text-text-strong">
              {advanced ? "Outside trader" : "Your trader"}
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-text-soft">Name</span>
            <input
              value={agentName}
              onChange={(event) => setAgentName(event.target.value)}
              placeholder="Hermes Momentum"
              className={INPUT_CLASS}
            />
          </label>

          {advanced ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-text-soft">Trader type</span>
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value as AgentKind)}
                className={INPUT_CLASS}
              >
                {AGENT_KINDS.filter((option) => option.value !== "mock").map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-text-soft">
              What should it focus on?
            </span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this trader should watch or trade."
              rows={4}
              className={clsx(INPUT_CLASS, "resize-none leading-relaxed")}
            />
          </label>

          {advanced ? (
            <div className="rounded-soft border border-border-soft bg-canvas px-3 py-3">
              <div className="grid gap-4">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-text-soft">
                    Public identity
                  </span>
                  <input
                    value={identityPubkey}
                    onChange={(event) => setIdentityPubkey(event.target.value)}
                    placeholder="Optional"
                    className={INPUT_CLASS}
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-text-soft">Home address</span>
                  <input
                    value={endpoint}
                    onChange={(event) => setEndpoint(event.target.value)}
                    placeholder="https://example.com"
                    className={INPUT_CLASS}
                  />
                </label>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-soft pt-4">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-text-soft">
              <Lock className="h-3 w-3" aria-hidden="true" />
              {encrypt.live ? "Privacy on" : "Privacy ready"}
            </span>
            <button
              type="submit"
              disabled={pending}
              className={clsx(
                "inline-flex min-h-tap items-center justify-center gap-1.5 rounded-soft bg-accent px-4 py-2 text-xs font-medium text-text-on-accent shadow-accent-rest",
                "transition-[background-color,box-shadow,transform] duration-base ease-out-soft",
                "hover:bg-accent-hover hover:shadow-accent-hover active:scale-[0.98]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
                "disabled:cursor-not-allowed disabled:opacity-60",
              )}
            >
              <Save size={13} aria-hidden="true" />
              {pending
                ? "Saving"
                : advanced
                  ? "Connect trader and continue"
                  : "Create trader and continue"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

const INPUT_CLASS = clsx(
  "w-full rounded-soft border border-border-soft bg-canvas px-3 py-2 text-sm text-text-strong",
  "placeholder:text-text-muted",
  "transition-[border-color,box-shadow] duration-base ease-out-soft",
  "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25",
);
