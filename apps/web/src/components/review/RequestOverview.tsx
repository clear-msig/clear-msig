import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import s from "./ReviewSurface.module.css";

export function RequestOverview({
  title,
  walletName,
  walletHref,
  status,
  created,
  collected,
  threshold,
  members,
  proposalAddress,
  children,
}: {
  title: string;
  walletName: string;
  walletHref: string;
  status: string;
  created: string;
  collected: number;
  threshold: number;
  members: number;
  proposalAddress?: string;
  children?: ReactNode;
}) {
  const remaining = Math.max(0, threshold - collected);
  return (
    <section className={`${s.surface} ${s.overview}`} aria-label="Request overview">
      <div className={s.top}>
        <Link className={s.breadcrumb} href={walletHref}>
          <ArrowLeft size={16} aria-hidden="true" />
          {walletName}
        </Link>
        <span className={s.status}>{status}</span>
      </div>
      <p className={s.kicker}>Request for approval</p>
      <h1 className={s.heading}>{title}</h1>
      <p className={s.subtitle}>{created}</p>
      <div className={s.progress}>
        <div className={s.segments} aria-hidden="true">
          {Array.from(
            { length: Math.min(16, Math.max(0, threshold)) },
            (_, i) => (
              <span
                key={i}
                className={s.segment}
                data-approved={i < collected}
              />
            ),
          )}
        </div>
        <div>
          <strong>
            {collected} of {threshold} required approvals
          </strong>
          <p>
            {members} eligible members ·{" "}
            {remaining > 0
              ? `${remaining} more needed`
              : "Approval threshold met"}
          </p>
        </div>
      </div>
      {proposalAddress ? (
        <p className={s.address}>
          Request account<code>{proposalAddress}</code>
        </p>
      ) : null}
      {children}
    </section>
  );
}
