import { describe, expect, it } from "vitest";
import { buildActivityCsv } from "../exportActivity";
import type { RecentActivityRow } from "@/lib/hooks/useRecentActivity";
import type { TxAttempt } from "../txLog";

const FULL = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

const row = {
  walletName: "ops",
  proposalPda: "ProposalPda11111111111111111111111111111111",
  proposedAt: 1_700_000_000n,
  status: 1,
  intentTemplate: "transfer 1 SOL to X",
  approvalBitmap: 1,
} as unknown as RecentActivityRow;

const attempt = {
  id: "a1",
  walletName: "ops",
  ts: 1_700_000_000_000 + 60_000,
  status: "success",
  txId: "sig123",
  recipientShort: "7xKX…AsU",
  recipientFull: FULL,
  amountDisplay: "1",
  ticker: "SOL",
} as unknown as TxAttempt;

describe("buildActivityCsv", () => {
  it("exports the full recipient address and flags the match as approximate", () => {
    const csv = buildActivityCsv({ rows: [row], attempts: [attempt] });
    expect(csv).toContain(FULL);
    expect(csv).not.toContain("7xKX…AsU");
    expect(csv).toContain("approximate: device log, time-matched");
  });

  it("keeps existing column order and appends the new column last", () => {
    const header = buildActivityCsv({ rows: [] }).replace("﻿", "").split("\r\n")[0];
    expect(header.startsWith("Date (UTC),Wallet,Type,Status")).toBe(true);
    expect(header.endsWith(",Ticker,Tx match")).toBe(true);
  });

  it("leaves match empty when no device log entry exists", () => {
    const csv = buildActivityCsv({ rows: [row] });
    expect(csv).not.toContain("approximate");
  });
});
