import { describe, expect, it } from "vitest";
import {
  documentBytes,
  documentHexRows,
  EXAMPLE_DESTINATION,
  EXAMPLE_DOCUMENT,
} from "./approvalDocument";

describe("landing example document", () => {
  it("uses the ClearSign v4 section order", () => {
    const titles = EXAMPLE_DOCUMENT.split("\n\n").map((p) => p.split("\n")[0]);
    expect(titles).toEqual(["ClearSig Approval", "ACTION", "DETAILS", "POLICY"]);
  });
  it("shows the full destination, never a shortened one", () => {
    expect(EXAMPLE_DOCUMENT).toContain(`To: ${EXAMPLE_DESTINATION}`);
  });
  it("hex rows decode back to exactly the readable document", () => {
    const hex = documentHexRows(12).join(" ").replace(/\s+/g, "");
    const decoded = new TextDecoder().decode(
      Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16)),
    );
    expect(decoded).toBe(EXAMPLE_DOCUMENT);
    expect(hex.length / 2).toBe(documentBytes().length);
  });
});
