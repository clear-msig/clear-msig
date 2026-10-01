import { Button } from "@/components/retail/Button";

export function rampStatusNotice(reason: string) {
  if (reason === "status_unavailable") {
    return {
      title: "Payment status unavailable",
      body: "We could not verify the latest status. This does not mean your payment failed. Do not pay or send crypto again while the outcome is unknown.",
    };
  }
  if (reason === "manual_review_required") {
    return {
      title: "Payment needs review",
      body: "This payment is awaiting operator review. Funds may already have moved. Do not start another payment or send crypto again. Keep the payment ID for support.",
    };
  }
  return {
    title:
      reason === "expired"
        ? "Payment expired"
        : reason === "cancelled"
          ? "Payment cancelled"
          : "Payment did not complete",
    body: "This status does not confirm whether funds were received or refunded. If you paid or sent crypto, keep the payment ID and contact support before trying again.",
  };
}

export function RampStatusNotice({
  reason,
  intentId,
  refreshing,
  onRefresh,
}: {
  reason: string;
  intentId: string;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const copy = rampStatusNotice(reason);
  return (
    <section
      role="alert"
      className="flex flex-col gap-3 rounded-card border border-warning/30 bg-warning/5 p-5 shadow-card-rest"
    >
      <h2 className="font-display text-lg text-text-strong">{copy.title}</h2>
      <p className="text-sm text-text-soft">{copy.body}</p>
      <p className="text-xs text-text-soft">
        Payment ID:{" "}
        <code className="break-all text-text-strong">{intentId}</code>
      </p>
      <Button variant="secondary" disabled={refreshing} onClick={onRefresh}>
        {refreshing ? "Checking status…" : "Refresh payment status"}
      </Button>
    </section>
  );
}
