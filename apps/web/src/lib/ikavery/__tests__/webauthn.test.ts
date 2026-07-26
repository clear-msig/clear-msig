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
        hasCredentialsCreate: true,
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
        hasCredentialsCreate: true,
        hasCredentialsGet: true,
      }),
    ).toEqual({ ok: true });
  });

  it("requires credential creation for passkey enrollment", () => {
    expect(
      detectWebauthnAvailability({
        isSecureContext: true,
        hasCredentialsCreate: false,
        hasCredentialsGet: true,
      }),
    ).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});
