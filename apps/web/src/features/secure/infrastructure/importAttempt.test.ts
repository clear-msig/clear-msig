import { describe, expect, it, vi } from "vitest";
import { runImportAttempt } from "./importAttempt";

describe("import attempt key custody", () => {
  it("wipes the key after successful import", async () => {
    const wipe = vi.fn();
    const result = await runImportAttempt({ run: async (progress) => { progress("submit"); progress("confirm"); return "vault"; }, wipe, onProgress: vi.fn() });
    expect(result).toEqual({ ok: true, value: "vault" });
    expect(wipe).toHaveBeenCalledOnce();
  });

  it("clears the key after wallet rejection without claiming a submission", async () => {
    const wipe = vi.fn();
    const error = new Error("Signature rejected");
    const result = await runImportAttempt({ run: async (progress) => { progress("sign"); throw error; }, wipe, onProgress: vi.fn() });
    expect(result).toEqual({ ok: false, error, submissionMayHaveStarted: false });
    expect(wipe).toHaveBeenCalledOnce();
  });

  it.each(["submit", "confirm"] as const)("does not present failures during %s as safe to retry", async (stage) => {
    const wipe = vi.fn();
    const error = new Error("RPC response lost");
    const result = await runImportAttempt({ run: async (progress) => { progress(stage); throw error; }, wipe, onProgress: vi.fn() });
    expect(result).toEqual({ ok: false, error, submissionMayHaveStarted: true });
    expect(wipe).toHaveBeenCalledOnce();
  });

  it("wipes after a preparation failure before any progress event", async () => {
    const wipe = vi.fn();
    await runImportAttempt({ run: async () => { throw new Error("Preparation failed"); }, wipe, onProgress: vi.fn() });
    expect(wipe).toHaveBeenCalledOnce();
  });
});
