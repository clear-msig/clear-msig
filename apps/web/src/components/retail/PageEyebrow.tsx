// PageEyebrow. The editorial-sans rebuild's signature treatment for
// page-level headlines: a thin accent hairline rule, a small all-caps
// label, then the headline below it. Borrowed from the SOL/ETH/ERC-20
// send-amount block; promoted here so every Hero on every page can
// pick it up without copy-pasting the spacing tokens.
//
// Use as:
//
//   <PageEyebrow label="Settings" align="center">
//     <h1 className="...display headline...">Settings</h1>
//     <p className="...">Your account and connection.</p>
//   </PageEyebrow>
//
// The accent rule width (w-12 desktop / w-10 stacked) is intentional:
// short enough to read as a typographic mark, not a decorative
// ornament. tracking-[0.24em] on the eyebrow caps mirrors the same
// number used on the send-page Amount label.

import type { ReactNode } from "react";

type Align = "left" | "center";

interface Props {
  label: string;
  align?: Align;
  children: ReactNode;
  className?: string;
}

export function PageEyebrow({
  label,
  align = "left",
  children,
  className,
}: Props) {
  const isCenter = align === "center";
  return (
    <header
      className={
        (isCenter ? "flex flex-col items-center text-center" : "flex flex-col") +
        (className ? " " + className : "")
      }
    >
      <span aria-hidden="true" className="block h-px w-10 bg-accent" />
      <p
        className={
          "mt-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft"
        }
      >
        {label}
      </p>
      <div className="mt-2">{children}</div>
    </header>
  );
}
