import {
  balanceChange,
  describeExpiry,
  describeTimelock,
  formatSol,
  parseReviewFacts,
  solToLamports,
} from "@/lib/review/reviewFacts";
import {
  addressFingerprint,
  assessDestination,
  groupAddress,
  type KnownAddress,
} from "@/lib/review/addressSafety";
import type { CanonicalProposalReview } from "@/lib/clearsign/proposalReview";
import s from "./ApprovalSummary.module.css";

export interface ApprovalSummaryContext {
  contacts: readonly KnownAddress[];
  recentRecipients: readonly string[];
  /** Vault SOL balance read just now; null when unknown. */
  vaultLamports: bigint | null;
  nowMs: number;
}

/// Plain-language reading of the verified document. It sits above the exact
/// document, which stays fully visible; it adds consequences and cues, it
/// never replaces or hides a signed field.
export function ApprovalSummary({
  review,
  context,
}: {
  review: CanonicalProposalReview;
  context: ApprovalSummaryContext;
}) {
  const facts = parseReviewFacts(review.sections);
  const expiry = describeExpiry(review.expiresAt, context.nowMs);
  const assessment = facts.destination
    ? assessDestination(facts.destination, context.contacts, context.recentRecipients)
    : null;
  const amountLamports =
    facts.amount?.ticker === "SOL" ? solToLamports(facts.amount.value) : null;
  const change =
    amountLamports !== null && context.vaultLamports !== null
      ? balanceChange(context.vaultLamports, amountLamports)
      : null;

  return (
    <section className={s.summary} aria-label="Plain-language summary">
      <div className={s.lead}>
        <p className={s.label}>You are approving</p>
        {facts.amount ? (
          <p className={s.amount}>
            {facts.amount.value}
            <span>{facts.amount.ticker}</span>
          </p>
        ) : (
          <p className={s.amount} style={{ fontSize: 28 }}>
            {review.headline}
          </p>
        )}
      </div>

      {facts.destination && assessment ? (
        <div className={s.to}>
          <p className={s.label}>To</p>
          <div className={s.toHead}>
            <span className={s.pips} aria-hidden="true">
              {addressFingerprint(facts.destination).map((hue, i) => (
                <i key={i} style={{ background: `hsl(${hue} 70% 55%)` }} />
              ))}
            </span>
            {assessment.kind === "saved" ? (
              <>
                <span className={s.name}>{assessment.name}</span>
                <span className={s.chip} data-tone="ok">Saved contact</span>
              </>
            ) : assessment.kind === "seen-before" ? (
              <span className={s.chip} data-tone="ok">Sent here before</span>
            ) : assessment.kind === "lookalike" ? (
              <span className={s.chip} data-tone="bad">
                Looks like {assessment.name}, but is different
              </span>
            ) : (
              <span className={s.chip} data-tone="warn">
                First time sending here
              </span>
            )}
          </div>
          <AddressBlock address={facts.destination} />
          {assessment.kind === "lookalike" ? (
            <div className={s.compare} role="alert">
              <p>
                The start and end match {assessment.name}&apos;s address but
                the middle differs. Attackers use this to swap a trusted
                address. Compare every group before approving.
              </p>
              <p>{assessment.name}&apos;s address:</p>
              <AddressBlock address={assessment.address} />
            </div>
          ) : null}
        </div>
      ) : null}

      <dl className={s.rows}>
        {facts.network ? (
          <div className={s.row}>
            <dt>Network</dt>
            <dd>{facts.network}</dd>
          </div>
        ) : null}
        {change ? (
          <div className={s.row}>
            <dt>Vault balance</dt>
            <dd>
              <span className={s.change}>
                <span className={s.before}>{formatSol(change.before)} SOL</span>
                <span aria-hidden="true">→</span>
                <strong data-bad={change.insufficient}>
                  {formatSol(change.after)} SOL
                </strong>
              </span>
              <small>
                {change.insufficient
                  ? "The vault holds less than this amount, so the request cannot complete."
                  : "Balance read now, before network fees."}
              </small>
            </dd>
          </div>
        ) : null}
        <div className={s.row}>
          <dt>Deadline</dt>
          <dd>
            {expiry.relative}
            {expiry.absoluteUtc ? <small>{expiry.absoluteUtc}</small> : null}
          </dd>
        </div>
        <div className={s.row}>
          <dt>When it runs</dt>
          <dd>{describeTimelock(review.timelockSeconds, review.threshold)}</dd>
        </div>
      </dl>
      <p className={s.note}>
        This summary is generated from the verified document below. The exact
        document is what you sign.
      </p>
    </section>
  );
}

function AddressBlock({ address }: { address: string }) {
  const groups = groupAddress(address);
  return (
    <p className={s.addr} aria-label={address}>
      {groups.map((g, i) =>
        i === 0 || i === groups.length - 1 ? (
          <b key={i}>{g}</b>
        ) : (
          <span key={i}>{g}</span>
        ),
      )}
    </p>
  );
}
