import { afterEach, describe, expect, it, vi } from "vitest";
import { configureNotificationTokenGetter } from "@/lib/notifications/sessionToken";
import { agentSessionHeaders } from "@/lib/agents/clientAuth";
import { loadAgentBackendState, syncAgentProfile } from "@/lib/agents/clientState";
import { submitAgentVenueExecution } from "@/lib/agents/clientExecution";
import type { AgentProfile, AgentTradeProposal } from "@/lib/agents/types";

afterEach(() => { configureNotificationTokenGetter(() => undefined); vi.unstubAllGlobals(); });
describe("agent browser authentication", () => {
  it("reads the current token for every request without caching a session subject", () => {
    let token = "first-session";
    configureNotificationTokenGetter(() => token);
    expect(agentSessionHeaders().Authorization).toBe("Bearer first-session");
    token = "second-session";
    expect(agentSessionHeaders().Authorization).toBe("Bearer second-session");
  });
  it("fails closed for hardware-only and signed-out sessions before any network call", async () => {
    configureNotificationTokenGetter(() => undefined);
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(() => agentSessionHeaders()).toThrow("Sign in with Dynamic");
    expect(await loadAgentBackendState("vault")).toMatchObject({ ok: false, message: expect.stringContaining("Sign in with Dynamic") });
    expect(await syncAgentProfile({ walletName: "vault" } as AgentProfile)).toMatchObject({ ok: false, message: expect.stringContaining("Sign in with Dynamic") });
    await expect(submitAgentVenueExecution({ walletName: "vault", venue: "mock_perps" } as AgentTradeProposal)).rejects.toThrow("Sign in with Dynamic");
    expect(fetch).not.toHaveBeenCalled();
  });
});
