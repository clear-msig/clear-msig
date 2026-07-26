"use client";

// React wrapper around evaluateFirstMatch that re-runs when any of
// the candidate-proposal inputs change. Used by the send pages as
// a compose-time tripwire - surfaces "this rule denies the send" /
// "extra approvers will be required" banners before the user fires
// the wallet popup.
//
// The evaluator is async (decrypts recipient lists in-memory).
// This hook tracks the last-resolved value + a loading flag so
// callers can render an in-flight state without flicker.

import { useEffect, useState } from "react";
import {
  evaluateFirstMatch,
  type CandidateProposal,
} from "@/lib/policies/evaluate";
import {
  listPolicies,
  subscribePolicies,
} from "@/lib/policies/storage";
import type { RuleEvaluation } from "@/lib/policies/types";

interface Args extends Omit<CandidateProposal, "at"> {
  /// Skip evaluation when false (e.g. while the user is still
  /// typing). Default true.
  enabled?: boolean;
}

export function usePolicyEvaluation(args: Args): RuleEvaluation | null {
  const {
    walletName,
    enabled = true,
    chainKind,
    tokenContract,
    recipient,
    ticker,
    amountDisplay,
  } = args;
  const [evaluation, setEvaluation] = useState<RuleEvaluation | null>(null);

  useEffect(() => {
    if (!enabled || !walletName) {
      setEvaluation(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      const rules = listPolicies(walletName);
      if (rules.length === 0) {
        if (!cancelled) setEvaluation(null);
        return;
      }
      try {
        const out = await evaluateFirstMatch(rules, {
          walletName,
          chainKind,
          tokenContract,
          recipient,
          ticker,
          amountDisplay,
        });
        if (!cancelled) setEvaluation(out);
      } catch {
        if (!cancelled) setEvaluation(null);
      }
    };
    void run();
    // Refresh on policy-list changes so a freshly-saved rule
    // applies on the same compose attempt without a navigate.
    const unsub = subscribePolicies(() => void run());
    return () => {
      cancelled = true;
      unsub();
    };
  }, [
    enabled,
    walletName,
    chainKind,
    tokenContract,
    recipient,
    ticker,
    amountDisplay,
  ]);

  return evaluation;
}
