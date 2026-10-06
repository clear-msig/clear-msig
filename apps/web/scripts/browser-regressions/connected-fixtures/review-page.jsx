"use client";
import { useState } from "react";
import { useSigningReview } from "@/features/send/infrastructure/useSigningReview";
import { SolanaSigningReview } from "@/features/send/ui/solana/SolanaSigningReview";
import { OwnerApprovalDialog } from "@/components/agents/OwnerApprovalDialog";
import { RouteSkeleton } from "@/components/retail/RouteSkeleton";
import { SendProgressStage } from "@/features/send/ui/SendProgressStage";
import { Button } from "@/components/retail/Button";
const destination = "LbUiWL3xVV8hTFYBVdbTNrpDo41NKS6o3LHHuDzjfcY";
export default function Fixture() {
  const flow = useSigningReview("synthetic-local-review");
  const [dialog, setDialog] = useState(false),
    [status, setStatus] = useState(""),
    [loading, setLoading] = useState(false);
  const begin = async () => {
    try {
      await flow
        .begin()
        .request({
          amount: "0.3",
          destination,
          document: `ClearSig Approval\n\nACTION\nSend 0.3 SOL\n\nDETAILS\nFrom wallet: Operations\nNetwork: Solana devnet\nTo: ${destination}\nAmount: 0.3 SOL\n\nPOLICY\n2 of 3 approvals required\n\nRISK\nSynthetic UI document. No signatures or chain verification.`,
        });
      setStatus("Fixture stopped before any wallet request.");
    } catch (e) {
      setStatus(e.message);
    }
  };
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8">
      <h1 className="text-3xl font-medium">Review-state fixtures</h1>
      <p className="text-sm text-text-soft">
        Real production components and review hook. Synthetic props only; no
        signing authority or live requests.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={begin}>Open signing review</Button>
        <Button onClick={() => setDialog(true)}>Open owner approval</Button>
        <Button onClick={() => setLoading((x) => !x)}>Toggle loading</Button>
      </div>
      {flow.review && (
        <SolanaSigningReview
          review={flow.review}
          onConfirm={flow.confirm}
          onCancel={flow.cancel}
        />
      )}
      <OwnerApprovalDialog
        request={
          dialog
            ? {
                walletName: "operations",
                action: "update_policy",
                summary: "Review practice trader limits",
                details: [
                  { label: "Wallet", value: "Operations" },
                  { label: "Execution", value: "Blocked — local fixture only" },
                  {
                    label: "Approval",
                    value: "Synthetic review; no authorization created",
                  },
                ],
              }
            : null
        }
        onCancel={() => setDialog(false)}
        onApprove={() => {
          setDialog(false);
          setStatus("Fixture stopped before approval.");
        }}
      />
      {loading && (
        <>
          <RouteSkeleton variant="detail" />
          <SendProgressStage
            primary="Preparing your request"
            hint="Local loading fixture. No wallet prompt or transaction has started."
          />
        </>
      )}
      {status && (
        <p role="status" className="text-sm">
          {status}
        </p>
      )}
    </section>
  );
}
