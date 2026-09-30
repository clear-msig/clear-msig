import { describe, expect, it, vi } from "vitest";
import { ApprovalCollectionClosedError, createApprovalCollection } from "./approvalCollection";

describe("recovery approval collection", () => {
  it("resolves only the matching pending proposal", async () => {
    const gate = createApprovalCollection(); gate.open();
    const settled = vi.fn();
    const waiting = gate.wait("proposal").then(settled);
    gate.complete("other-proposal");
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    gate.complete("proposal");
    gate.complete("proposal");
    await waiting;
    expect(settled).toHaveBeenCalledOnce();
  });

  it("rejects an abandoned wait so execution cannot resume after navigation", async () => {
    const gate = createApprovalCollection(); gate.open();
    const execute = vi.fn();
    const waiting = gate.wait("proposal").then(execute);
    const rejected = expect(waiting).rejects.toBeInstanceOf(ApprovalCollectionClosedError);
    gate.close();
    gate.complete("proposal");
    await rejected;
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects collection started by a stale callback after navigation", async () => {
    const gate = createApprovalCollection(); gate.open(); gate.close();
    await expect(gate.wait("late")).rejects.toBeInstanceOf(ApprovalCollectionClosedError);
  });

  it("supports Strict Mode effect setup/cleanup without reviving the old wait", async () => {
    const gate = createApprovalCollection(); gate.open(); gate.close(); gate.open();
    const waiting = gate.wait("new");
    gate.complete("new");
    await expect(waiting).resolves.toBeUndefined();
  });

  it("does not replace an existing unresolved request", async () => {
    const gate = createApprovalCollection(); gate.open();
    const first = gate.wait("first");
    await expect(gate.wait("second")).rejects.toThrow("already waiting");
    gate.complete("first");
    await first;
  });
});
