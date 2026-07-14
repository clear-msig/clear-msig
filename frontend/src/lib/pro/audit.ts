"use client";

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api/client";

export interface ProAuditEvent {
  id: string;
  walletName: string;
  eventType: string;
  title: string;
  reference?: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}

interface ProAuditEnvelope {
  ok: boolean;
  data: {
    wallet_name: string;
    events: unknown[];
  };
}

export function useProAuditEvents(walletName: string) {
  return useQuery({
    queryKey: ["pro-audit-events", walletName],
    queryFn: () => fetchProAuditEvents(walletName),
    enabled: walletName.trim().length > 0,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
}

export async function fetchProAuditEvents(
  walletName: string,
): Promise<ProAuditEvent[]> {
  if (!walletName.trim()) return [];
  const response = await apiRequest<ProAuditEnvelope>(
    `/v1/pro/wallets/${encodeURIComponent(walletName)}/audit-events`,
    "GET",
    undefined,
    { timeoutMs: 8_000 },
  );
  return response.data.events.filter(isProAuditEvent);
}

function isProAuditEvent(value: unknown): value is ProAuditEvent {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.walletName === "string" &&
    typeof row.eventType === "string" &&
    typeof row.title === "string" &&
    (row.reference === undefined || typeof row.reference === "string") &&
    !!row.metadata &&
    typeof row.metadata === "object" &&
    typeof row.createdAt === "number"
  );
}
