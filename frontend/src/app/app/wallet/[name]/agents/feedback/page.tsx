"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Check, MessageSquare, Trash2 } from "lucide-react";
import { Button } from "@/components/retail/Button";
import {
  FormField,
  NativeSelect,
  TextArea,
  TextInput,
} from "@/components/retail/FormField";
import { useToast } from "@/components/ui/Toast";
import {
  clearAgentBetaFeedback,
  listAgentBetaFeedback,
  saveAgentBetaFeedback,
  type AgentBetaFeedbackItem,
  type AgentBetaFeedbackKind,
} from "@/features/agents/infrastructure/browserRuntime";
import { toDisplayName } from "@/lib/retail/walletNames";

const FEEDBACK_KINDS: Array<{ value: AgentBetaFeedbackKind; label: string }> = [
  { value: "bug", label: "Bug" },
  { value: "confusing", label: "Confusing" },
  { value: "missing_feature", label: "Missing feature" },
  { value: "trust", label: "Trust/Safety" },
  { value: "performance", label: "Performance" },
  { value: "other", label: "Other" },
];

export default function AgentFeedbackPage() {
  const params = useParams<{ name: string }>();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const name = useMemo(() => decodeParam(params?.name), [params?.name]);
  const encoded = encodeURIComponent(name);
  const display = toDisplayName(name);
  const [kind, setKind] = useState<AgentBetaFeedbackKind>("bug");
  const [route, setRoute] = useState("");
  const [contact, setContact] = useState("");
  const [message, setMessage] = useState("");
  const [items, setItems] = useState<AgentBetaFeedbackItem[]>([]);

  useEffect(() => {
    setRoute(window.location.pathname.replace("/feedback", ""));
    setItems(listAgentBetaFeedback(name));
  }, [name]);

  const submit = () => {
    startTransition(() => {
      try {
        saveAgentBetaFeedback({
          walletName: name,
          route: route.trim() || `/app/wallet/${encoded}/agents`,
          kind,
          message,
          contact,
          context: {
            page: "agent-feedback",
            userAgent:
              typeof navigator !== "undefined" ? navigator.userAgent : undefined,
          },
        });
        setMessage("");
        setItems(listAgentBetaFeedback(name));
        toast.success("Feedback saved");
      } catch (error) {
        toast.error("Could not save feedback", {
          details: error instanceof Error ? error.message : String(error),
        });
      }
    });
  };

  const clearAll = () => {
    startTransition(() => {
      clearAgentBetaFeedback(name);
      setItems([]);
      toast.success("Feedback cleared");
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Link
          href={`/app/wallet/${encoded}/agents`}
          className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-text-soft transition-colors hover:text-accent"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Agent Trading
        </Link>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
            Beta Feedback · {display}
          </p>
          <h1 className="mt-1 font-display text-lg leading-tight text-text-strong md:text-display-xs">
            Feedback
          </h1>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
        <div className="rounded-card bg-surface-raised p-4 shadow-card-rest">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-text-strong">
                Capture tester feedback
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-text-soft">
                Save public beta issues with route and context while the tester is still in the flow.
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3">
            <FormField label="Type">
              <NativeSelect
                value={kind}
                onChange={(event) => setKind(event.target.value as AgentBetaFeedbackKind)}
              >
                {FEEDBACK_KINDS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Route">
              <TextInput
                value={route}
                onChange={(event) => setRoute(event.target.value)}
              />
            </FormField>
            <FormField label="Contact">
              <TextInput
                value={contact}
                onChange={(event) => setContact(event.target.value)}
                placeholder="Optional"
              />
            </FormField>
            <FormField label="What happened?">
              <TextArea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={5}
              />
            </FormField>
            <Button
              disabled={pending}
              onClick={submit}
              size="sm"
              fullWidth
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              Save feedback
            </Button>
          </div>
        </div>

        <section className="rounded-card bg-surface-raised p-4 shadow-card-rest">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-text-strong">
                Recent feedback
              </h2>
              <p className="mt-1 text-xs text-text-soft">
                {items.length} saved locally
              </p>
            </div>
            <Button
              variant="danger"
              size="sm"
              disabled={pending || items.length === 0}
              onClick={clearAll}
            >
              <Trash2 className="h-3 w-3" aria-hidden="true" />
              Clear
            </Button>
          </div>
          <div className="mt-4 grid gap-2">
            {items.length > 0 ? (
              items.slice(0, 8).map((item) => <FeedbackRow key={item.id} item={item} />)
            ) : (
              <div className="rounded-soft border border-dashed border-border-soft bg-canvas px-3 py-4 text-sm text-text-soft">
                No feedback saved yet.
              </div>
            )}
          </div>
        </section>
      </section>
    </div>
  );
}

function FeedbackRow({ item }: { item: AgentBetaFeedbackItem }) {
  return (
    <article className="rounded-soft border border-border-soft bg-canvas px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge>{kindLabel(item.kind)}</Badge>
        <span className="text-[11px] text-text-soft">
          {new Date(item.createdAt).toLocaleString()}
        </span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-text-strong">
        {item.message}
      </p>
      <p className="mt-1 break-words text-[11px] text-text-soft">
        {item.route}
      </p>
      {item.contact ? (
        <p className="mt-1 text-[11px] text-text-soft">{item.contact}</p>
      ) : null}
    </article>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border-soft bg-surface-raised px-1.5 py-0.5 text-[10px] font-medium text-text-soft">
      {children}
    </span>
  );
}

function decodeParam(value: string | undefined): string {
  const raw = value ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function kindLabel(kind: AgentBetaFeedbackKind): string {
  return FEEDBACK_KINDS.find((item) => item.value === kind)?.label ?? "Other";
}
