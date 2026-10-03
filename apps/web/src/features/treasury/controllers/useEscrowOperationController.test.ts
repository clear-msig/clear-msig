import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import bs58 from "bs58";
import type { Connection } from "@solana/web3.js";
import type { ProEscrowProject } from "@/lib/pro/escrow";
import { useEscrowOperationController } from "./useEscrowOperationController";
import {
  escrowPaths,
  type EscrowOperation,
} from "../infrastructure/escrowOperation";
const mocks = vi.hoisted(() => ({
  generation: 0,
  read: vi.fn(),
  submit: vi.fn(),
  save: vi.fn(),
  info: vi.fn(),
}));
// Synthetic identity invalidation and external boundaries; controller/execution state machine are real.
vi.mock("@/lib/hooks/useRequestIdentity", () => ({
  useRequestIdentity: () => ({
    capture: () => {
      const generation = mocks.generation;
      return {
        assertCurrent: () => {
          if (generation !== mocks.generation)
            throw new Error("Identity changed");
        },
      };
    },
  }),
}));
vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ info: mocks.info }),
}));
vi.mock("../infrastructure/escrowOperation", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../infrastructure/escrowOperation")
  >()),
  readEscrowEvidence: mocks.read,
  submitEscrowExecution: mocks.submit,
  saveEscrowOperation: mocks.save,
}));
const record: EscrowOperation = {
  version: 1,
  walletName: "test",
  proposalAddress: "proposal",
  envelopeHash: "a".repeat(64),
  payloadHash: "b".repeat(64),
  phase: "created",
  execute: {
    kind: "release",
    escrowId: "escrow",
    milestoneId: "mile",
    recipient: "recipient",
    amountLamports: 1,
  },
};
const evidence = {
  sections: [
    { title: "DETAILS", text: "Escrow ID: escrow\nMilestone ID: mile" },
  ],
  proposalAddress: record.proposalAddress,
  envelopeHash: record.envelopeHash,
  payloadHash: record.payloadHash,
  binding: { actionKind: 7 },
  status: 1,
};
const txid = bs58.encode(new Uint8Array(64).fill(2));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function controller() {
  let result!: ReturnType<typeof useEscrowOperationController>;
  function Harness() {
    result = useEscrowOperationController({
      walletName: "test",
      project: { id: "escrow", milestones: [] } as unknown as ProEscrowProject,
      connection: { rpcEndpoint: "synthetic" } as Connection,
      onRelease: vi.fn(),
      onUpdate: vi.fn(),
    });
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  return result;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.generation = 0;
  mocks.read.mockResolvedValue(evidence);
  mocks.submit.mockResolvedValue({
    txid,
    proposal: "proposal",
    path: escrowPaths.release,
  });
});
describe("escrow lifecycle boundaries (synthetic providers)", () => {
  it("prevents execution when finalized preflight returns after invalidation", async () => {
    const pending = deferred<typeof evidence>();
    mocks.read.mockReturnValue(pending.promise);
    const operation = controller().executeSaved(record);
    mocks.generation++;
    pending.resolve(evidence);
    await expect(operation).rejects.toThrow("Identity changed");
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("retains accepted transaction evidence after invalidation during submission", async () => {
    const pending = deferred<unknown>();
    mocks.submit.mockReturnValue(pending.promise);
    const operation = controller().executeSaved(record);
    await vi.waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    mocks.generation++;
    pending.resolve({ txid, proposal: "proposal", path: escrowPaths.release });
    await expect(operation).rejects.toThrow("Identity changed");
    expect(mocks.save.mock.calls.at(-1)?.[1]).toMatchObject({
      phase: "submitted",
      txid,
    });
    expect(mocks.info).not.toHaveBeenCalled();
  });
  it("retains uncertain request identity after invalidation and malformed response", async () => {
    const pending = deferred<unknown>();
    mocks.submit.mockReturnValue(pending.promise);
    const operation = controller().executeSaved(record);
    await vi.waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    mocks.generation++;
    pending.resolve({});
    await expect(operation).rejects.toThrow("Identity changed");
    expect(mocks.save.mock.calls.at(-1)?.[1]).toMatchObject({
      phase: "unknown",
      proposalAddress: "proposal",
    });
    expect(mocks.submit).toHaveBeenCalledOnce();
  });
  it("honors the original preparation identity before a new execution attempt", async () => {
    const c = controller();
    const check = c.captureIdentity();
    mocks.generation++;
    await expect(c.executeSaved(record, check)).rejects.toThrow(
      "Identity changed",
    );
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});
