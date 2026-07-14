import { describe, expect, it, vi } from "vitest";
import { fetchProAuditEvents } from "@/lib/pro/audit";

describe("Pro audit backend feed", () => {
  it("reads durable backend audit events for the selected wallet", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            wallet_name: "Team",
            events: [
              {
                id: "evt-1",
                walletName: "Team",
                eventType: "schedule_saved",
                title: "Saved payroll",
                metadata: {},
                createdAt: 123,
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchProAuditEvents("Team")).resolves.toMatchObject([
      { id: "evt-1", title: "Saved payroll" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v1/pro/wallets/Team/audit-events"),
      expect.objectContaining({ method: "GET" }),
    );
    vi.unstubAllGlobals();
  });
});
