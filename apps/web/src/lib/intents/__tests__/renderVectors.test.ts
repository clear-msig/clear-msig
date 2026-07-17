import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ParamType, type ParamEntry } from "@/lib/msig/definition";
import { renderTemplateToString } from "@/lib/msig/render";

const PARAM_TYPES: Record<string, ParamType> = {
  address: ParamType.Address,
  u64: ParamType.U64,
  i64: ParamType.I64,
  string: ParamType.String,
  bool: ParamType.Bool,
  u8: ParamType.U8,
  u16: ParamType.U16,
  u32: ParamType.U32,
  u128: ParamType.U128,
  bytes20: ParamType.Bytes20,
  bytes32: ParamType.Bytes32,
};

interface RenderVector {
  id: string;
  template: string;
  paramTypes: string[];
  paramsDataHex: string;
  expected: string;
}

describe("shared Rust and TypeScript intent render vectors", () => {
  const artifact = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "../../examples/intents/render-vectors-v1.json"),
      "utf8",
    ),
  ) as { schemaVersion: number; vectors: RenderVector[] };

  it("uses the active intent schema version", () => {
    expect(artifact.schemaVersion).toBe(1);
  });

  for (const vector of artifact.vectors) {
    it(`renders ${vector.id} byte-for-byte`, () => {
      const params = vector.paramTypes.map((name): ParamEntry => {
        const paramType = PARAM_TYPES[name];
        if (paramType === undefined) {
          throw new Error(`Unknown vector parameter type ${name}`);
        }
        return {
          paramType,
          nameOffset: 0,
          nameLen: 0,
          constraintType: 0,
          constraintValue: 0n,
        };
      });
      expect(
        renderTemplateToString(
          { params, bytePool: new Uint8Array(), template: vector.template },
          Uint8Array.from(Buffer.from(vector.paramsDataHex, "hex")),
        ),
      ).toBe(vector.expected);
    });
  }
});
