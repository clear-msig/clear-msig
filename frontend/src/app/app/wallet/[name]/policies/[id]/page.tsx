"use client";

// Edit / view a single policy rule. Wraps the same PolicyForm the
// /new page uses so the shape stays in lockstep. Initial values are
// loaded from storage and (for the recipient + extra-approver
// fields) decrypted via decryptConditions before priming the form
// inputs.

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { decryptConditions } from "@/lib/policies/encryption";
import { findPolicy } from "@/lib/policies/storage";
import type { PolicyRule } from "@/lib/policies/types";
import { PolicyForm } from "@/app/app/wallet/[name]/policies/new/page";

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
      // Decrypt the recipient list so the form pre-fills with the
      // plaintext addresses the user originally typed.
      const conditions = await decryptConditions(raw.conditions);
      if (cancelled) return;
      setRule({ ...raw, conditions });
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
          className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-border-soft px-3 py-1 text-xs text-text-soft hover:border-accent hover:text-accent"
        >
          Back to policies
        </button>
      </div>
    );
  }

  return <PolicyForm mode="edit" initial={rule} />;
}
