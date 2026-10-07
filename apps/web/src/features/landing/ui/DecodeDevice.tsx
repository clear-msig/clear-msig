"use client";

import { useState } from "react";
import {
  documentBytes,
  documentHexRows,
  EXAMPLE_SECTIONS,
} from "../domain/approvalDocument";
import s from "./DecodeDevice.module.css";

type Mode = "auto" | "raw" | "read";

const ROWS = documentHexRows(12);
const BYTE_COUNT = documentBytes().length;

/// The hero visual: the same bytes, first as a blind-signing wallet shows
/// them, then as the sentence ClearSig renders. The default sequence is plain
/// CSS (works with no JavaScript and is disabled for reduced motion); the
/// buttons let anyone hold either view.
export function DecodeDevice() {
  const [mode, setMode] = useState<Mode>("auto");
  const [run, setRun] = useState(0);
  return (
    <figure className={s.device} data-mode={mode} aria-label="Same bytes, two views">
      <div className={s.chrome}>
        <span className={s.chromeTitle}>Wallet · Sign message</span>
        <span className={s.net}>Solana devnet · example</span>
      </div>

      <div className={s.screen}>
        <div className={s.raw} aria-hidden={mode === "read" ? true : undefined}>
          <p className={s.warn}>
            <i aria-hidden="true" /> Blind signing · {BYTE_COUNT} bytes · cannot be read
          </p>
          <pre className={s.hex}>
            {ROWS.map((row, i) => (
              <span key={i}>{row}{"\n"}</span>
            ))}
          </pre>
        </div>

        <div
          key={run}
          className={s.read}
          style={run > 0 ? ({ "--delay": "0s" } as React.CSSProperties) : undefined}
        >
          <p className={s.ok}>
            <i aria-hidden="true" /> ClearSig · readable before you sign
          </p>
          {EXAMPLE_SECTIONS.map((section) => (
            <section key={section.title} className={s.section}>
              <p className={s.sectionTitle}>{section.title}</p>
              {section.lines.map(([label, value]) => (
                <p key={`${section.title}-${label ?? value}`} data-big={label === null || undefined}>
                  {label ? <span>{label}</span> : null}
                  <b className={label === "To" ? s.mono : undefined}>{value}</b>
                </p>
              ))}
            </section>
          ))}
        </div>
        <span className={s.scan} key={`scan-${run}`} aria-hidden="true" />
      </div>

      <figcaption className={s.foot}>
        <div className={s.toggle} role="group" aria-label="Choose a view">
          <button type="button" aria-pressed={mode === "raw"} onClick={() => setMode("raw")}>
            Raw bytes
          </button>
          <button
            type="button"
            aria-pressed={mode !== "raw"}
            onClick={() => {
              setRun((n) => n + 1);
              setMode("auto");
            }}
          >
            Readable
          </button>
        </div>
        <span>Same bytes. Two views.</span>
      </figcaption>
    </figure>
  );
}
