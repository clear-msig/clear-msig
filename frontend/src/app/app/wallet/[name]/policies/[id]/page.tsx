"use client";

// Edit / view a single policy rule. Wraps the same PolicyForm the
// /new page uses so the shape stays in lockstep. Initial values are
// loaded from storage and decrypted via the policy encryption helpers
// before priming the form inputs.

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { decryptPolicy } from "@/lib/encrypt/client";
import {
  decryptConditions,
  decryptCooldownSeconds,
} from "@/lib/policies/encryption";
import { findPolicy } from "@/lib/policies/storage";
import type { PolicyRule } from "@/lib/policies/types";
import { PolicyForm } from "@/components/policies/PolicyForm";

export default function EditPolicyPage() {
  const params = useParams<{ name: string; id: string }>();
  const router = useRouter();
  const name = useMemo(() => {
    try {
      return decodeURIComponent(params?.name ?? "");
    } catch {
      return params?.name ?? "";
    }
  }, [params?.name]);
  const id = params?.id ?? "";

  const [rule, setRule] = useState<PolicyRule | null>(null);
  const [extraApproversText, setExtraApproversText] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const raw = findPolicy(name, id);
      if (!raw) {
        if (!cancelled) {
          setRule(null);
          setLoading(false);
        }
        return;
      }
      const conditions = await decryptConditions(raw.conditions);
      const extraApprovers = await decryptStringList(
        raw.extraApproversEncrypted ?? [],
      );
      const extraCooldownSeconds = await decryptCooldownSeconds(
        raw.extraCooldownEncrypted,
        raw.extraCooldownSeconds,
      );
      if (cancelled) return;
      setExtraApproversText(extraApprovers.join("\n"));
      setRule({ ...raw, conditions, extraCooldownSeconds });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [name, id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-text-soft">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading rule…
      </div>
    );
  }
  if (!rule) {
    return (
      <div className="rounded-card border border-border-soft bg-surface-raised p-8 text-center shadow-card-rest">
        <p className="text-sm font-medium text-text-strong">
          Rule not found
        </p>
        <p className="mt-1 text-xs text-text-soft">
          It may have been deleted from another tab.
        </p>
        <button
          type="button"
          onClick={() =>
            router.push(`/app/wallet/${encodeURIComponent(name)}/policies`)
          }
          className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-border-soft px-3 py-1 text-xs text-text-soft hover:text-accent"
        >
          Back to policies
        </button>
      </div>
    );
  }

  return (
    <PolicyForm
      mode="edit"
      initial={rule}
      initialExtraApproversText={extraApproversText}
    />
  );
}

async function decryptStringList(
  payloads: NonNullable<PolicyRule["extraApproversEncrypted"]>,
): Promise<string[]> {
  const decoder = new TextDecoder();
  const out: string[] = [];
  for (const payload of payloads) {
    try {
      const text = decoder.decode(await decryptPolicy(payload)).trim();
      if (text) out.push(text);
    } catch {
      /* skip unreadable values */
    }
  }
  return out;
}
