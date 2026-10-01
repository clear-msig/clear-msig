export function EscrowRecordNotice() {
  return (
    <p className="mt-3 text-sm leading-relaxed text-text-soft">
      Saved project record only. Saving or editing this record does not deposit,
      lock, release, or return funds. Recorded amounts are estimates from saved
      entries, not verified on-chain balances. Release and return requests
      require a separate signed proposal and successful execution.
    </p>
  );
}
