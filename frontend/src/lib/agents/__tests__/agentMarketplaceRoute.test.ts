import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as readMarketplace } from "@/app/api/agent-marketplace/route";
import { saveAgentServerProfile } from "@/lib/agents/serverState";
import type { AgentProfile } from "@/lib/agents/types";

const now = Date.UTC(2026, 5, 1, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("agent marketplace route", () => {
  it("returns an empty registry when no marketplace wallets are configured", async () => {
    vi.stubEnv("CLEARSIG_AGENT_MARKETPLACE_WALLETS", "");
    vi.stubEnv("CLEARSIG_AGENT_MARKETPLACE_ALLOW_QUERY", "");

    const response = await readMarketplace(
      new NextRequest("http://localhost/api/agent-marketplace"),
    );
    const body = (await response.json()) as {
      ok?: boolean;
      registry?: { entries?: unknown[]; message?: string };
      source?: string;
      walletCount?: number;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.source).toBe("empty");
    expect(body.walletCount).toBe(0);
    expect(body.registry?.entries).toEqual([]);
  });

  it("loads approved agents from the explicit query registry when enabled", async () => {
    vi.stubEnv("CLEARSIG_AGENT_MARKETPLACE_WALLETS", "");
    vi.stubEnv("CLEARSIG_AGENT_MARKETPLACE_ALLOW_QUERY", "1");
    await saveAgentServerProfile(agent("route-marketplace-vault"));

    const response = await readMarketplace(
      new NextRequest(
        "http://localhost/api/agent-marketplace?wallets=route-marketplace-vault",
      ),
    );
    const body = (await response.json()) as {
      ok?: boolean;
      registry?: { entries?: Array<{ slug?: string; url?: string }> };
      source?: string;
      walletCount?: number;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.source).toBe("query");
    expect(body.walletCount).toBe(1);
    expect(body.registry?.entries?.[0]).toMatchObject({
      slug: "route-alpha",
      url: "/agents/route-marketplace-vault/route-alpha",
    });
  });
});

function agent(walletName: string): AgentProfile {
  return {
    id: "route-alpha",
    walletName,
    name: "Route Alpha",
    kind: "api",
    status: "active",
    identityPubkey: "route-alpha-pubkey",
    strategy: {
      mode: "paper",
      summary: "Route alpha test strategy.",
      allowedMarkets: ["BTC-PERP"],
      entryRules: "Enter confirmed setups.",
      exitRules: "Exit failed setups.",
      riskRules: "Small size only.",
      executionProtocol: "Submit decisions to ClearSig.",
      killSwitchRules: "Pause on abnormal losses.",
      updatedAt: now,
    },
    publishing: {
      status: "published",
      slug: "route-alpha",
      publicSummary: "Route Alpha public profile.",
      visibleMetrics: ["score", "realized_pnl"],
      moderation: {
        status: "approved",
        reason: "Reviewed.",
        reviewedAt: now,
        updatedAt: now,
        version: 1,
      },
      publishedAt: now,
      updatedAt: now,
      version: 1,
    },
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

