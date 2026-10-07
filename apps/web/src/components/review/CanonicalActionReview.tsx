import type { CanonicalProposalReview } from "@/lib/clearsign/proposalReview";
import s from "./ReviewSurface.module.css";
import {
  ApprovalSummary,
  type ApprovalSummaryContext,
} from "./ApprovalSummary";
export function CanonicalActionReview({
  review,
  error,
  loading,
  onRefresh,
  summaryContext,
}: {
  review?: CanonicalProposalReview;
  error?: string;
  loading: boolean;
  onRefresh: () => void;
  /** When supplied, a plain-language summary is shown above the exact document. */
  summaryContext?: ApprovalSummaryContext;
}) {
  return (
    <section className={s.surface} aria-label="Canonical action review">
      <p className={s.kicker}>Verify before approving</p>
      {loading ? (
        <p role="status">Loading the finalized action document…</p>
      ) : error ? (
        <p role="alert">Approval blocked. {error}</p>
      ) : review ? (
        <>
          <h2 className={s.heading}>{review.headline}</h2>
          {summaryContext ? (
            <ApprovalSummary review={review} context={summaryContext} />
          ) : null}
          <p className={s.subtitle}>
            Exact v4 document bound to this request’s on-chain envelope.
            Required: {review.threshold} of {review.binding.approvers.length}{" "}
            members.
          </p>
          <p className={s.address}>
            Wallet account<code>{review.binding.wallet}</code>
          </p>
          <p className={s.address}>
            Request account<code>{review.proposalAddress}</code>
          </p>
          <p className={s.subtitle}>
            Expires (Unix seconds): {review.expiresAt.toString()}
          </p>
          <p className={s.subtitle}>
            Current approval timelock: {review.timelockSeconds} seconds.
          </p>
          {review.sections
            .filter((section) => section.title !== "ACTION")
            .map((section) => (
              <div className={s.canonicalSection} key={section.title}>
                <h3>{section.title}</h3>
                <pre>{section.text}</pre>
              </div>
            ))}
          <div className={s.canonicalSection}>
            <h3>Network fees</h3>
            <p>
              No verified fee estimate is included in this document. Fees are
              unknown here; no zero-fee assumption is made.
            </p>
          </div>
          <p className={s.address}>
            Action envelope<code>{review.envelopeHash}</code>
          </p>
        </>
      ) : (
        <p role="alert">
          Approval blocked. Canonical action details are unavailable.
        </p>
      )}
      <button
        type="button"
        className={s.refresh}
        onClick={onRefresh}
        disabled={loading}
      >
        {loading ? "Checking…" : "Refresh verified details"}
      </button>
    </section>
  );
}
