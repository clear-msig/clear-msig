import { Button } from "@/components/retail/Button";
export function HistoryReadNotice({
  refreshing,
  onRefresh,
}: {
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <section
      role="alert"
      className="flex flex-col gap-3 rounded-card border border-warning/30 bg-warning/5 p-4"
    >
      <h2 className="font-semibold text-text-strong">
        History could not be fully loaded
      </h2>
      <p className="text-sm text-text-soft">
        Wallet or chain reads failed. Any rows shown may be stale or incomplete;
        this does not mean there was no activity. Totals and export are
        unavailable until the reads succeed.
      </p>
      <Button variant="secondary" disabled={refreshing} onClick={onRefresh}>
        {refreshing ? "Refreshing history…" : "Refresh history"}
      </Button>
    </section>
  );
}
