"use client";

import { Fragment, useLayoutEffect, useState } from "react";
import {
  activateAgentLocalStateScope, agentLocalStateScopeId, clearAgentLocalStateScope,
} from "@/features/agents/local-state/scope";
import { hasUnscopedAgentHistory, recoverLegacyAgentProfiles } from "@/features/agents/local-state/legacyRecovery";

/** Mount once above agent routes; null identity renders no private descendants. */
export function AgentLocalStateBoundary({
  sessionSubject, walletPda, walletName, chainNamespace, children,
}: {
  sessionSubject: string | null;
  walletPda: string | null;
  walletName: string;
  chainNamespace: string | null;
  children: React.ReactNode;
}) {
  let scopeId: string | null = null;
  try {
    if (sessionSubject && walletPda && chainNamespace) scopeId = agentLocalStateScopeId({ sessionSubject, walletPda, chainNamespace });
  } catch { /* Invalid or unresolved identities remain locked. */ }
  const [readyScope, setReadyScope] = useState<string | null>(null);
  const [legacyAvailable, setLegacyAvailable] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState("");

  useLayoutEffect(() => {
    setReadyScope(null);
    setRecoveryMessage("");
    if (!scopeId || !sessionSubject || !walletPda || !chainNamespace) {
      clearAgentLocalStateScope();
      return;
    }
    const release = activateAgentLocalStateScope({ sessionSubject, walletPda, chainNamespace });
    setLegacyAvailable(hasUnscopedAgentHistory());
    setReadyScope(scopeId);
    return release;
  }, [scopeId, sessionSubject, walletPda, chainNamespace]);

  if (!scopeId || readyScope !== scopeId) {
    return <p role="status" className="p-6 text-sm text-text-soft">Unlocking agent data for your signed-in wallet…</p>;
  }

  const recover = () => {
    const confirmedOwnership = window.confirm(
      "Only continue if the older agent data on this device belongs to you and this wallet. Copy inactive trader profile text into this account? Trading keys, approvals, budgets, trades, and venue settings will stay separate. Original data will be preserved.",
    );
    if (!confirmedOwnership) return;
    try {
      const count = recoverLegacyAgentProfiles({ walletName, expectedScopeId: scopeId, confirmedOwnership });
      setRecoveryMessage(`${count} inactive trader profile${count === 1 ? "" : "s"} recovered. Older data remains preserved separately.`);
    } catch (error) {
      setRecoveryMessage(error instanceof Error ? error.message : "Recovery could not be completed.");
    }
  };

  return <Fragment key={scopeId}>
    {legacyAvailable && <div className="m-4 rounded-lg border border-border p-3 text-sm text-text-soft">
      <p>Older agent data on this device is preserved separately and hasn’t been assigned to this account.</p>
      <button type="button" className="mt-2 underline" onClick={recover}>Recover my trader profiles</button>
      {recoveryMessage && <p role="status" className="mt-2">{recoveryMessage}</p>}
    </div>}
    {children}
  </Fragment>;
}
