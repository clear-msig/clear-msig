"use client";

import { useState } from "react";
import { Pause, Play } from "lucide-react";
import { CHAINS } from "@/components/landing/ChainLogos";
import s from "./ChainMarquee.module.css";

const chains = CHAINS.filter((chain) =>
  ["btc", "eth", "hyperliquid", "sol", "zec"].includes(chain.key),
);

/** The original network artwork, with a single accessible list and a seamless decorative copy. */
export function ChainMarquee() {
  const [paused, setPaused] = useState(false);
  return (
    <section className={s.strip} aria-label="ClearSig network ecosystem">
      <noscript>
        <style>{`
          .${s.track} { animation: none; width: 100%; transform: none; }
          .${s.group} { min-width: 0; width: 100%; padding: 0; flex-wrap: wrap; justify-content: center; gap: 20px 28px; }
          .${s.group}[aria-hidden="true"], .${s.pause} { display: none; }
          .${s.viewport} { mask-image: none; }
        `}</style>
      </noscript>
      <div className={s.heading}>
        <p>Across networks. Under your control.</p>
        <button
          type="button"
          className={s.pause}
          onClick={() => setPaused((value) => !value)}
          aria-pressed={paused}
          aria-label={
            paused ? "Resume network animation" : "Pause network animation"
          }
        >
          {paused ? (
            <Play size={14} aria-hidden="true" />
          ) : (
            <Pause size={14} aria-hidden="true" />
          )}
          {paused ? "Resume" : "Pause"}
        </button>
      </div>
      <div className={s.viewport}>
        <div className={s.track} data-paused={paused}>
          {[false, true].map((duplicate) => (
            <ul
              key={String(duplicate)}
              className={s.group}
              aria-hidden={duplicate || undefined}
            >
              {chains.map(({ key, label, Logo }) => (
                <li key={key}>
                  <span aria-hidden="true">
                    <Logo size={28} />
                  </span>
                  <span>{label}</span>
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
      <p className={s.disclosure}>
        Devnet and testnet preview. Availability varies by product.
      </p>
    </section>
  );
}
