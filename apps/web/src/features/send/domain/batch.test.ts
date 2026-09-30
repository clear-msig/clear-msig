import { describe, expect, it } from "vitest";
import {
  parseBatchCsv,
  parseBatchAmountToLamports,
  resolveRow,
  totalBatchLamports,
  MAX_BATCH_RECIPIENTS,
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

  it("preserves every imported digit and leaves invalid syntax for correction", () => {
    for (const amount of ["0.000000001", "1.234567891", "-1", "1e3", "$12.345678", "1.2.3"]) {
      const result = parseBatchCsv(`name,address,asset,amount\nTreasury,11111111111111111111111111111111,SOL,${amount}`);
      expect(result.rows[0]?.amount).toBe(amount);
    }
  });

  it.each([
    ["0.000000001", 1n],
    ["1.234567891", 1234567891n],
    ["9007199.254740989", 9007199254740989n],
    ["9007199.254740991", 9007199254740991n],
    [".5", 500000000n],
    ["1.", 1000000000n],
  ])("converts %s to exact lamports", (input, expected) => {
    expect(parseBatchAmountToLamports(input)).toBe(expected);
  });

  it.each(["", "0", "0.0000000001", "1.0000000001", "9007199.254740992", "-1", "+1", "1e3", "0x10", "$12.34", "1,000", "1.2.3", "Infinity", "NaN"])("rejects unsupported or ambiguous amount %s", (amount) => {
    expect(parseBatchAmountToLamports(amount)).toBeNull();
    expect(resolveRow({ id: "row", recipient: "11111111111111111111111111111111", amount }, [])).toEqual({ kind: "invalid-amount" });
  });

  it("does not round unsafe-looking-but-supported input while resolving recipients", () => {
    expect(resolveRow({ id: "row", recipient: "11111111111111111111111111111111", amount: "9007199.254740989" }, [])).toMatchObject({
      kind: "valid",
      lamports: "9007199254740989",
    });
  });

  it("sums batches without losing integer precision", () => {
    const total = totalBatchLamports([
      { kind: "valid", destination: "recipient", label: "A", lamports: "9007199254740991" },
      { kind: "valid", destination: "recipient", label: "B", lamports: "2" },
    ]);
    expect(total).toBe(9007199254740993n);
  });

  it("matches the atomic batch executor's recipient limit", () => {
    expect(MAX_BATCH_RECIPIENTS).toBe(16);
  });

  it("rejects oversized imported amounts before integer conversion", () => {
    expect(parseBatchAmountToLamports("9".repeat(100_000))).toBeNull();
    expect(parseBatchAmountToLamports(`${"0".repeat(100_000)}1`)).toBeNull();
  });
});
