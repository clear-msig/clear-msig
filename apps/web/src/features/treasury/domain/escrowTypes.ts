import type { BackendClearSignV4Summary } from "@/lib/clearsign";
import type { TypedDryRunDescriptor } from "@/lib/api/types";

export interface EscrowDraft {
  executionMode: "sol" | "spl" | "cross_chain" | "private";
  network: "Solana devnet" | "Ethereum Sepolia" | "Bitcoin testnet" | "Zcash testnet" | "Hyperliquid testnet";
  chainKind: string;
  asset: string;
  assetId: string;
  decimals: string;
  mint: string;
  sourceToken: string;
  funderTokenAccount: string;
  recipientTokenAccount: string;
  routeHash: string;
  settlementArtifactHash: string;
  privateEvaluationHash: string;
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
      }
    | {
        kind: "spl_release";
        mint: string;
        sourceToken: string;
        destinationToken: string;
        recipientOwner: string;
        amountTokens: number;
        escrowId: string;
        milestoneId: string;
      }
    | {
        kind: "spl_return";
        mint: string;
        sourceToken: string;
        escrowId: string;
        returns: Array<{
          destinationToken: string;
          funderOwner: string;
          amountTokens: number;
        }>;
      }
    | {
        kind: "cross_chain_release";
        chainKind: number;
        amountRaw: string;
        escrowId: string;
        milestoneId: string;
        recipientHash: string;
        assetIdHash: string;
        routeHash: string;
        settlementArtifactHash: string;
      }
    | {
        kind: "cross_chain_return";
        chainKind: number;
        amountRaw: string;
        escrowId: string;
        refundRecipientHash: string;
        assetIdHash: string;
        routeHash: string;
        settlementArtifactHash: string;
      }
    | {
        kind: "private_release";
        amountRaw: string;
        escrowId: string;
        milestoneId: string;
        recipientHash: string;
        assetIdHash: string;
        privateEvaluationHash: string;
        settlementArtifactHash: string;
      }
    | {
        kind: "private_return";
        amountRaw: string;
        escrowId: string;
        refundRecipientHash: string;
        assetIdHash: string;
        privateEvaluationHash: string;
        settlementArtifactHash: string;
      };
}
