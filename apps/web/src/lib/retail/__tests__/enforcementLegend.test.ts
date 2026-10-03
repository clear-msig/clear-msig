import { describe, expect, it } from "vitest";
import {
  ENFORCEMENT_LAYER_LABEL,
  ENFORCEMENT_LEGEND,
} from "../enforcementLegend";

describe("ENFORCEMENT_LEGEND", () => {
  it("covers each protection exactly once", () => {
    expect(ENFORCEMENT_LEGEND.map((r) => r.id).sort()).toEqual(
      ["delay", "hours", "limits", "recipients", "threshold"],
    );
  });

  it("never claims a browser-checked rule is unconditionally on-chain", () => {
    for (const row of ENFORCEMENT_LEGEND) {
      if (row.id === "limits" || row.id === "recipients" || row.id === "hours") {
        expect(row.layer).toBe("program-after-sync");
        expect(row.detail).toMatch(/Checked here before you sign/);
      }
    }
  });

  it("has a label for every layer used", () => {
    for (const row of ENFORCEMENT_LEGEND) {
      expect(ENFORCEMENT_LAYER_LABEL[row.layer]).toBeTruthy();
    }
  });
});
