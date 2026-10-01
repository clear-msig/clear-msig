import { Button } from "@/components/retail/Button";

export function AgentFundingReadStatus({
  address,
  loadingAddress,
  addressError,
  loadingSources,
  sourcesError,
  connected,
  sourceCount,
  refreshing,
  onRefresh,
}: {
  address: string | null;
  loadingAddress: boolean;
  addressError: boolean;
  loadingSources: boolean;
  sourcesError: boolean;
  connected: boolean;
  sourceCount: number;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const retryable =
    addressError || sourcesError || (!loadingAddress && !address);
  return (
    <div className="mt-3 flex flex-col gap-3 text-sm text-text-soft">
      {addressError ? (
        <p role="alert">
          Could not verify this vault’s deposit address. Do not send funds using
          a stale address.
        </p>
      ) : loadingAddress ? (
        <p role="status">Loading deposit address…</p>
      ) : address ? (
        <code className="break-all rounded-soft border border-border-soft bg-canvas px-3 py-2 text-xs text-text-strong">
          {address}
        </code>
      ) : (
        <p>
          No deposit address was found for this vault. Refresh or check the
          wallet setup before funding.
        </p>
      )}
      {!connected ? (
        <p>Connect your wallet to load available Pro treasuries.</p>
      ) : sourcesError ? (
        <p role="alert">
          Could not load source treasuries. This does not mean you have no
          treasuries.
        </p>
      ) : loadingSources ? (
        <p role="status">Loading source treasuries…</p>
      ) : sourceCount === 0 ? (
        <p>No eligible Pro treasury was found for the connected wallet.</p>
      ) : null}
      {retryable && (
        <Button variant="secondary" disabled={refreshing} onClick={onRefresh}>
          {refreshing
            ? "Refreshing funding details…"
            : "Refresh funding details"}
        </Button>
      )}
    </div>
  );
}
