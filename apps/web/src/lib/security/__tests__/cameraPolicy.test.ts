import { describe, expect, it } from "vitest";
import nextConfig from "../../../../next.config";

describe("QR scanner permissions policy", () => {
  it("allows only same-origin camera requests without enabling unrelated permissions", async () => {
    const rules = await nextConfig.headers();
    const policy = rules[0].headers.find((header) => header.key === "Permissions-Policy")?.value;
    expect(policy).toBe("camera=(self), microphone=(), geolocation=(), payment=(), usb=()");
  });
});
