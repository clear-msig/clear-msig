import { describe, expect, it } from "vitest";
import { detectWebauthnAvailability } from "../webauthn";

describe("WebAuthn availability", () => {
  it("flags insecure contexts", () => {
    expect(detectWebauthnAvailability({ isSecureContext: false })).toEqual({
      ok: false,
      reason: "insecure",
    });
  });

  it("flags unavailable WebAuthn APIs", () => {
    expect(
      detectWebauthnAvailability({
        isSecureContext: true,
        hasCredentialsGet: false,
      }),
    ).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("accepts secure contexts with credential support", () => {
    expect(
      detectWebauthnAvailability({
        isSecureContext: true,
        hasCredentialsGet: true,
      }),
    ).toEqual({ ok: true });
  });
});
