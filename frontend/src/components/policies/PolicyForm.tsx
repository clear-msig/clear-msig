"use client";

// Shared policy create + edit form. Lives outside any route's
// page.tsx because Next.js app-router type validation rejects
// named exports from page files. The /new + /[id] pages are thin
// wrappers around this component.
//
// Covers five condition shapes most useful for a multisig
// treasury: asset filter, recipient allow/blocklist, amount range,
// time window, velocity cap.
//
// What gets encrypted: recipient lists + extra-approver lists. Other
// numeric/temporal conditions stay plaintext today; when on-chain
// FHE handlers land, the same shapes will encrypt then via a single
// extension to lib/policies/encryption.ts.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  Loader2,
  Lock,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Breadcrumb } from "@/components/retail/Breadcrumb";
import { StickyTopBar } from "@/components/retail/StickyTopBar";
import { Button } from "@/components/retail/Button";
import { useToast } from "@/components/ui/Toast";
import { encryptStatus } from "@/lib/encrypt/client";
import {
  encryptApprovers,
  encryptConditions,
} from "@/lib/policies/encryption";
import { newRuleId, savePolicy } from "@/lib/policies/storage";
import type {
  AmountCondition,
  AssetCondition,
  PolicyRule,
  RecipientCondition,
  RuleAction,
  RuleCondition,
  TimeWindowCondition,
  VelocityCondition,
} from "@/lib/policies/types";
import { toDisplayName } from "@/lib/retail/walletNames";

type ConditionKind = RuleCondition["kind"];

interface FormProps {
  mode: "create" | "edit";
  initial?: PolicyRule;
}

export function PolicyForm({ mode, initial }: FormProps) {
  const params = useParams<{ name: string }>();
  const router = useRouter();
  const toast = useToast();
  const reduce = useReducedMotion();
  const name = useMemo(() => {
    try {
      return decodeURIComponent(params?.name ?? "");
    } catch {
      return params?.name ?? "";
    }
  }, [params?.name]);

  const [ruleName, setRuleName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [priority, setPriority] = useState(initial?.priority ?? 100);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [action, setAction] = useState<RuleAction>(
    initial?.action ?? "require-extra-approvers",
  );
  const [extraCooldownSeconds, setExtraCooldownSeconds] = useState(
    initial?.extraCooldownSeconds ?? 24 * 60 * 60,
  );
  const [extraApproversText, setExtraApproversText] = useState("");
  const [conditions, setConditions] = useState<RuleCondition[]>(
    initial?.conditions ?? [
      { kind: "asset", chainKind: null } as AssetCondition,
    ],
  );
  const [busy, setBusy] = useState(false);

  const status = encryptStatus();

  const canSubmit = ruleName.trim().length > 0 && conditions.length > 0;

  const handleSubmit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    try {
      // Encrypt the recipient-condition addresses + the extra-
      // approver list. Numeric / temporal conditions pass through
      // verbatim today.
      const encryptedConditions = await encryptConditions(conditions);
      const extraApproverInputs = extraApproversText
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const extraApproversEncrypted = extraApproverInputs.length
        ? await encryptApprovers(extraApproverInputs)
        : undefined;

      const now = Date.now();
      const rule: PolicyRule = {
        id: initial?.id ?? newRuleId(),
        walletName: name,
        name: ruleName.trim(),
        description: description.trim() || undefined,
        priority,
        enabled,
        conditions: encryptedConditions,
        action,
        extraApproversEncrypted,
        extraCooldownSeconds:
          action === "require-cooldown" ? extraCooldownSeconds : undefined,
        updatedAt: now,
        createdAt: initial?.createdAt ?? now,
        version: 1,
      };
      savePolicy(rule);
      toast.success(
        mode === "create" ? `Saved "${rule.name}"` : "Rule updated",
      );
      router.push(`/app/wallet/${encodeURIComponent(name)}/policies`);
    } catch (err) {
      console.error("[policy-save]", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't save policy",
      );
    } finally {
      setBusy(false);
    }
  };

  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  return (
    <div className="flex flex-col gap-6">
      <StickyTopBar offset="header">
        <Breadcrumb
          segments={[
            { label: "Wallets", href: "/app/wallet" },
            {
              label: toDisplayName(name),
              href: `/app/wallet/${encodeURIComponent(name)}`,
            },
            {
              label: "Policies",
              href: `/app/wallet/${encodeURIComponent(name)}/policies`,
            },
            { label: mode === "create" ? "New rule" : "Edit rule" },
          ]}
        />
      </StickyTopBar>

      <motion.section
        {...motionProps}
        transition={{ duration: 0.2 }}
        className="flex flex-col gap-4 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest"
      >
        <header>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
            {mode === "create" ? "New policy rule" : "Edit policy rule"}
          </p>
          <p className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-text-soft">
            <Lock className="h-3 w-3" aria-hidden="true" />
            {status.live
              ? "Encryption active — condition values flow as ciphertext."
              : "Encryption-ready · pre-alpha. Condition values route through Encrypt's local stub today."}
          </p>
        </header>

        <Field label="Name">
          <input
            type="text"
            value={ruleName}
            onChange={(e) => setRuleName(e.target.value.slice(0, 80))}
            placeholder="e.g. Cold-wallet allowlist"
            autoFocus
            className={inputClass}
          />
        </Field>
        <Field label="Description (optional)">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 200))}
            placeholder="What this rule is for"
            className={inputClass}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Priority">
            <input
              type="number"
              min={0}
              max={1000}
              value={priority}
              onChange={(e) => setPriority(parseInt(e.target.value, 10) || 0)}
              className={inputClass}
            />
            <p className="mt-1 text-[10px] text-text-soft">
              Higher fires first. First match wins.
            </p>
          </Field>
          <Field label="Status">
            <button
              type="button"
              onClick={() => setEnabled(!enabled)}
              className={
                "rounded-card border px-3 py-2 text-xs font-medium transition-[border-color,background-color] duration-base ease-out-soft " +
                (enabled
                  ? "border-accent bg-accent/[0.08] text-accent"
                  : "border-border-soft bg-canvas text-text-soft")
              }
            >
              {enabled ? "Enabled" : "Paused"}
            </button>
          </Field>
        </div>
      </motion.section>

      {/* Conditions */}
      <motion.section
        {...motionProps}
        transition={{ duration: 0.2, delay: 0.05 }}
        className="flex flex-col gap-4 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest"
      >
        <header className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
            Conditions
          </p>
          <ConditionMenu onAdd={(k) => setConditions([...conditions, blankCondition(k)])} />
        </header>
        {conditions.length === 0 ? (
          <p className="text-xs text-text-soft">
            Add at least one condition.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {conditions.map((c, i) => (
              <li
                key={i}
                className="rounded-soft border border-border-soft bg-canvas p-3"
              >
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-text-soft">
                    {labelForKind(c.kind)}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      setConditions(conditions.filter((_, j) => j !== i))
                    }
                    aria-label="Remove condition"
                    className="rounded-soft p-1 text-text-soft transition-colors hover:bg-surface-raised hover:text-rose-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
                <ConditionEditor
                  condition={c}
                  onChange={(next) => {
                    const copy = [...conditions];
                    copy[i] = next;
                    setConditions(copy);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </motion.section>

      {/* Action */}
      <motion.section
        {...motionProps}
        transition={{ duration: 0.2, delay: 0.1 }}
        className="flex flex-col gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest"
      >
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
          Action when conditions match
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            [
              "deny",
              "allow",
              "require-extra-approvers",
              "require-cooldown",
            ] as RuleAction[]
          ).map((a) => {
            const active = action === a;
            return (
              <button
                key={a}
                type="button"
                onClick={() => setAction(a)}
                className={
                  "rounded-card border p-3 text-left transition-[border-color,background-color] duration-base ease-out-soft " +
                  (active
                    ? "border-accent bg-accent/[0.08]"
                    : "border-border-soft bg-canvas hover:border-accent/40")
                }
              >
                <p className="text-xs font-medium text-text-strong">
                  {actionTitle(a)}
                </p>
                <p className="mt-1 text-[10px] leading-snug text-text-soft">
                  {actionHint(a)}
                </p>
              </button>
            );
          })}
        </div>

        {action === "require-extra-approvers" && (
          <Field label="Extra approver pubkeys (one per line)">
            <textarea
              rows={3}
              value={extraApproversText}
              onChange={(e) => setExtraApproversText(e.target.value)}
              placeholder={"Solana base58 or 0x EVM addresses\nseparated by commas or newlines"}
              className={
                inputClass + " font-mono text-xs leading-relaxed"
              }
            />
            <p className="mt-1 text-[10px] text-text-soft">
              Encrypted via Encrypt — addresses don&rsquo;t leave this device
              in plaintext.
            </p>
          </Field>
        )}

        {action === "require-cooldown" && (
          <Field label="Extra cooldown (seconds)">
            <input
              type="number"
              min={0}
              value={extraCooldownSeconds}
              onChange={(e) =>
                setExtraCooldownSeconds(parseInt(e.target.value, 10) || 0)
              }
              className={inputClass}
            />
            <p className="mt-1 text-[10px] text-text-soft">
              Stacked on top of the on-chain intent&rsquo;s timelock.
            </p>
          </Field>
        )}
      </motion.section>

      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/app/wallet/${encodeURIComponent(name)}/policies`}
          className="inline-flex items-center gap-1.5 rounded-soft px-2 py-1 text-xs text-text-soft hover:text-text-strong"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden="true" />
          Back
        </Link>
        <Button
          size="lg"
          onClick={handleSubmit}
          disabled={!canSubmit || busy}
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Saving
            </>
          ) : (
            <>
              <Check className="h-4 w-4" aria-hidden="true" strokeWidth={3} />
              {mode === "create" ? "Save rule" : "Save changes"}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function ConditionMenu({ onAdd }: { onAdd: (k: ConditionKind) => void }) {
  const [open, setOpen] = useState(false);
  const opts: { kind: ConditionKind; label: string }[] = [
    { kind: "asset", label: "Asset / chain" },
    { kind: "recipient", label: "Recipient list" },
    { kind: "amount", label: "Amount range" },
    { kind: "time-window", label: "Time window" },
    { kind: "velocity", label: "Velocity cap" },
  ];
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={
          "inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1 text-[11px] font-medium text-white " +
          "transition-[background-color,transform] duration-base ease-out-soft hover:bg-accent-hover active:scale-[0.98]"
        }
      >
        <Plus className="h-3 w-3" aria-hidden="true" />
        Add condition
      </button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 w-48 overflow-hidden rounded-card border border-border-soft bg-surface-raised shadow-card-raised">
          {opts.map((o) => (
            <button
              key={o.kind}
              type="button"
              onClick={() => {
                onAdd(o.kind);
                setOpen(false);
              }}
              className="block w-full px-3 py-2 text-left text-xs text-text-strong hover:bg-canvas"
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ConditionEditor({
  condition,
  onChange,
}: {
  condition: RuleCondition;
  onChange: (next: RuleCondition) => void;
}) {
  switch (condition.kind) {
    case "asset":
      return <AssetEditor condition={condition} onChange={onChange} />;
    case "recipient":
      return <RecipientEditor condition={condition} onChange={onChange} />;
    case "amount":
      return <AmountEditor condition={condition} onChange={onChange} />;
    case "time-window":
      return <TimeWindowEditor condition={condition} onChange={onChange} />;
    case "velocity":
      return <VelocityEditor condition={condition} onChange={onChange} />;
  }
}

function AssetEditor({
  condition,
  onChange,
}: {
  condition: AssetCondition;
  onChange: (c: RuleCondition) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-xs text-text-soft">
        Chain
        <select
          value={condition.chainKind ?? "any"}
          onChange={(e) =>
            onChange({
              ...condition,
              chainKind:
                e.target.value === "any" ? null : parseInt(e.target.value, 10),
            })
          }
          className="rounded-soft border border-border-soft bg-surface-raised px-2 py-1 text-xs text-text-strong"
        >
          <option value="any">Any chain</option>
          <option value="0">Solana</option>
          <option value="1">Ethereum</option>
          <option value="4">Ethereum (ERC-20)</option>
          <option value="2">Bitcoin</option>
          <option value="3">Zcash</option>
        </select>
      </label>
      {condition.chainKind === 4 && (
        <label className="flex flex-col gap-1 text-xs text-text-soft">
          Token contract (optional)
          <input
            type="text"
            value={condition.tokenContract ?? ""}
            onChange={(e) =>
              onChange({ ...condition, tokenContract: e.target.value })
            }
            placeholder="0x… (USDC, DAI, etc.)"
            className={inputClass + " font-mono text-xs"}
          />
        </label>
      )}
    </div>
  );
}

function RecipientEditor({
  condition,
  onChange,
}: {
  condition: RecipientCondition;
  onChange: (c: RuleCondition) => void;
}) {
  const text = (condition.addresses ?? []).join("\n");
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-xs text-text-soft">
        Mode
        <select
          value={condition.mode}
          onChange={(e) =>
            onChange({
              ...condition,
              mode: e.target.value as "allowlist" | "blocklist",
            })
          }
          className="rounded-soft border border-border-soft bg-surface-raised px-2 py-1 text-xs text-text-strong"
        >
          <option value="allowlist">Allowlist</option>
          <option value="blocklist">Blocklist</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-soft">
        Addresses (one per line)
        <textarea
          rows={4}
          value={text}
          onChange={(e) =>
            onChange({
              ...condition,
              addresses: e.target.value
                .split(/[\s,]+/)
                .map((s) => s.trim())
                .filter((s) => s.length > 0),
            })
          }
          className={inputClass + " font-mono text-xs leading-relaxed"}
        />
        <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-text-soft">
          <Lock className="h-3 w-3" aria-hidden="true" />
          Encrypted on save — list never persists in plaintext.
        </span>
      </label>
    </div>
  );
}

function AmountEditor({
  condition,
  onChange,
}: {
  condition: AmountCondition;
  onChange: (c: RuleCondition) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <label className="flex flex-col gap-1 text-xs text-text-soft">
        Min
        <input
          type="text"
          inputMode="decimal"
          value={condition.minDisplay ?? ""}
          onChange={(e) =>
            onChange({ ...condition, minDisplay: e.target.value || null })
          }
          placeholder="0"
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-soft">
        Max
        <input
          type="text"
          inputMode="decimal"
          value={condition.maxDisplay ?? ""}
          onChange={(e) =>
            onChange({ ...condition, maxDisplay: e.target.value || null })
          }
          placeholder="∞"
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-soft">
        Ticker
        <input
          type="text"
          value={condition.ticker ?? ""}
          onChange={(e) =>
            onChange({ ...condition, ticker: e.target.value || null })
          }
          placeholder="SOL"
          className={inputClass}
        />
      </label>
    </div>
  );
}

function TimeWindowEditor({
  condition,
  onChange,
}: {
  condition: TimeWindowCondition;
  onChange: (c: RuleCondition) => void;
}) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const toggleDay = (d: number) => {
    const set = new Set(condition.daysOfWeek);
    if (set.has(d)) set.delete(d);
    else set.add(d);
    onChange({ ...condition, daysOfWeek: Array.from(set).sort() });
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2">
        <label className="flex flex-col gap-1 text-xs text-text-soft">
          Start hour
          <input
            type="number"
            min={0}
            max={23}
            value={condition.startHour}
            onChange={(e) =>
              onChange({
                ...condition,
                startHour: clampHour(parseInt(e.target.value, 10)),
              })
            }
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-soft">
          End hour
          <input
            type="number"
            min={0}
            max={23}
            value={condition.endHour}
            onChange={(e) =>
              onChange({
                ...condition,
                endHour: clampHour(parseInt(e.target.value, 10)),
              })
            }
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-soft">
          Match
          <select
            value={condition.match}
            onChange={(e) =>
              onChange({
                ...condition,
                match: e.target.value as "inside" | "outside",
              })
            }
            className="rounded-soft border border-border-soft bg-surface-raised px-2 py-1 text-xs text-text-strong"
          >
            <option value="inside">Inside window</option>
            <option value="outside">Outside window</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {days.map((d, i) => {
          const on = condition.daysOfWeek.includes(i);
          return (
            <button
              key={i}
              type="button"
              onClick={() => toggleDay(i)}
              className={
                "rounded-full border px-2.5 py-0.5 text-[11px] font-medium " +
                (on
                  ? "border-accent bg-accent/[0.08] text-accent"
                  : "border-border-soft bg-surface-raised text-text-soft")
              }
            >
              {d}
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-text-soft">
        Empty days set = every day. Hours are local time on this device.
      </p>
    </div>
  );
}

function VelocityEditor({
  condition,
  onChange,
}: {
  condition: VelocityCondition;
  onChange: (c: RuleCondition) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <label className="flex flex-col gap-1 text-xs text-text-soft">
        Cap
        <input
          type="text"
          inputMode="decimal"
          value={condition.capDisplay}
          onChange={(e) =>
            onChange({ ...condition, capDisplay: e.target.value })
          }
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-soft">
        Ticker
        <input
          type="text"
          value={condition.ticker}
          onChange={(e) => onChange({ ...condition, ticker: e.target.value })}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-soft">
        Window
        <select
          value={condition.windowDays}
          onChange={(e) =>
            onChange({
              ...condition,
              windowDays: parseInt(e.target.value, 10) as 1 | 7 | 30,
            })
          }
          className="rounded-soft border border-border-soft bg-surface-raised px-2 py-1 text-xs text-text-strong"
        >
          <option value="1">Daily</option>
          <option value="7">Weekly</option>
          <option value="30">Monthly</option>
        </select>
      </label>
    </div>
  );
}

function blankCondition(k: ConditionKind): RuleCondition {
  switch (k) {
    case "asset":
      return { kind: "asset", chainKind: null };
    case "recipient":
      return { kind: "recipient", mode: "allowlist", addresses: [] };
    case "amount":
      return { kind: "amount", minDisplay: null, maxDisplay: null, ticker: null };
    case "time-window":
      return {
        kind: "time-window",
        startHour: 9,
        endHour: 17,
        daysOfWeek: [1, 2, 3, 4, 5],
        match: "inside",
      };
    case "velocity":
      return {
        kind: "velocity",
        capDisplay: "1",
        ticker: "SOL",
        windowDays: 1,
      };
  }
}

function labelForKind(k: ConditionKind): string {
  switch (k) {
    case "asset":
      return "Asset / chain";
    case "recipient":
      return "Recipient list";
    case "amount":
      return "Amount range";
    case "time-window":
      return "Time window";
    case "velocity":
      return "Velocity cap";
  }
}

function actionTitle(a: RuleAction): string {
  switch (a) {
    case "deny":
      return "Deny";
    case "allow":
      return "Allow";
    case "require-extra-approvers":
      return "Extra approvers";
    case "require-cooldown":
      return "Extra cooldown";
  }
}

function actionHint(a: RuleAction): string {
  switch (a) {
    case "deny":
      return "Block at compose-time. User can't sign.";
    case "allow":
      return "Allow with the wallet's existing threshold. Build allowlist-then-deny rules with this.";
    case "require-extra-approvers":
      return "On top of the on-chain threshold, require these specific signers.";
    case "require-cooldown":
      return "Add wait time on top of the intent's timelock.";
  }
}

function clampHour(h: number): number {
  if (!Number.isFinite(h)) return 0;
  return Math.max(0, Math.min(23, Math.floor(h)));
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-text-soft">
      <span className="font-medium uppercase tracking-[0.18em]">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "rounded-soft border border-border-soft bg-canvas px-3 py-2 text-sm text-text-strong outline-none " +
  "transition-[border-color,box-shadow] duration-base ease-out-soft " +
  "focus:border-accent focus:shadow-accent-rest";
