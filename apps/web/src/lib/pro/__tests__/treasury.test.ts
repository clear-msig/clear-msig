import { describe, expect, it } from "vitest";
import { buildProAccountingCsv, type ProSchedule } from "@/lib/pro/treasury";

describe("buildProAccountingCsv", () => {
  it("exports payment attempts and recurring schedules with finance fields", () => {
    const schedule: ProSchedule = {
      id: "schedule-1",
      name: "Acme, Inc",
      address: "9xQeWvG816bUx9EPf5nEoKXe4Vv9h3",
      category: "vendor",
      amount: "12.5",
      asset: "SOL",
      cadence: "Monthly",
      nextRun: "2026-07-01",
      note: "Invoice 42",
      createdAt: 1_782_000_000_000,
    };

    const csv = buildProAccountingCsv({
      walletName: "Team",
      attempts: [
        {
          id: "attempt-1",
          walletName: "Team",
          chainKind: 0,
          status: "success",
          amountDisplay: "1.2",
          ticker: "SOL",
          recipientShort: "Sarah",
          recipientFull: "SarahWallet11111111111111111111111111111",
          txId: "sig-1",
          ts: 1_782_000_000_000,
        },
      ],
      schedules: [schedule],
    });

    expect(csv.split("\n")).toEqual([
      "record_type,wallet,date,name,asset,amount,status,reference,note,address,cadence",
      "payment_attempt,Team,2026-06-21T00:00:00.000Z,Sarah,SOL,1.2,success,sig-1,,SarahWallet11111111111111111111111111111,",
      'recurring_schedule,Team,2026-07-01,"Acme, Inc",SOL,12.5,vendor,schedule-1,Invoice 42,9xQeWvG816bUx9EPf5nEoKXe4Vv9h3,Monthly',
    ]);
  });
});
