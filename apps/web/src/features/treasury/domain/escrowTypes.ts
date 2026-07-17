import type { BackendClearSignV4Summary } from "@/lib/clearsign";
import type { TypedDryRunDescriptor } from "@/lib/api/types";

export interface EscrowDraft {
  title: string;
  counterparty: string;
  funderName: string;
  funderEntity: string;
  funderAddress: string;
  fundedAmount: string;
  milestoneTitle: string;
  recipient: string;
  recipientEntity: string;
  milestoneAmount: string;
}
export interface PreparedEscrowAction {
  title: string;
  summary: BackendClearSignV4Summary;
  dry: TypedDryRunDescriptor;
  cta: string;
  execute:
    | {
        kind: "release";
        recipient: string;
        amountLamports: number;
        escrowId: string;
        milestoneId: string;
      }
    | {
        kind: "return";
        escrowId: string;
        returns: Array<{ recipient: string; amountLamports: number }>;
      };
}
