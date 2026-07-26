import { describe, expect, it } from "vitest";
import {
  parseBatchCsv,
  resolveRow,
  sanitizeAmount,
} from "@/features/send/domain/batch";

describe("batch send domain", () => {
  it("imports only payable SOL rows and preserves quoted recipients", () => {
    const result = parseBatchCsv(
      [
        "name,address,asset,amount,note",
        '"Payroll, Ops",11111111111111111111111111111111,SOL,0.25,July',
        "Ignored,11111111111111111111111111111111,USDC,10,Wrong asset",
      ].join("\n"),
    );

    expect(result.skipped).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      recipient: "11111111111111111111111111111111",
      amount: "0.25",
    });
  });

  it("resolves a contact and converts SOL to exact lamports", () => {
    expect(
      resolveRow(
        { id: "row-1", recipient: "Treasury", amount: "1.23456789" },
        [
          {
            id: "contact-1",
            name: "Treasury",
            address: "11111111111111111111111111111111",
            createdAt: 1,
          },
        ],
      ),
    ).toEqual({
      kind: "valid",
      label: "Treasury",
      destination: "11111111111111111111111111111111",
      lamports: "1234567890",
    });
  });

  it("normalizes imported amounts without accepting extra punctuation", () => {
    expect(sanitizeAmount("$12.345678")).toBe("12.3456");
  });
});
