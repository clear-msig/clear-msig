import Link from "next/link";
export function LegacySetupNotice({ error }: { error: unknown }) {
  if (!error) return null;
  const proposal =
    typeof error === "object" &&
    error &&
    "proposalAddress" in error &&
    typeof error.proposalAddress === "string"
      ? error.proposalAddress
      : undefined;
  return (
    <section
      role="alert"
      className="my-4 rounded-card border border-border-soft bg-surface-raised p-4 text-text-strong"
    >
      <h2 className="font-semibold">Setup paused</h2>
      <p className="mt-2 break-words text-sm text-text-soft">
        {error instanceof Error
          ? error.message
          : "Setup could not be verified. Check any existing request before retrying."}
      </p>
      {proposal && (
        <Link
          className="mt-3 inline-flex min-h-11 items-center text-accent underline"
          href={`/app/proposals/${encodeURIComponent(proposal)}`}
        >
          Open existing request
        </Link>
      )}
    </section>
  );
}
