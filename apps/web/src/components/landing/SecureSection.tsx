"use client";

import { motion, useReducedMotion } from "framer-motion";
import { SecureVaultMockup } from "./SecureVaultMockup";
/* ─────────────────────────────────────────────────────────────────
 *  SecureSection. Landing-page hero for the personal-vault product.
 *
 *  Visual: a glass card with an animated orbital quorum. Four device
 *  nodes orbit a central shield core. Energy beams travel from each
 *  device into the core as they sign; once threshold is met the
 *  core "unlocks", a signature hex types itself out, and the card
 *  settles into a ready state. The whole loop repeats so the section
 *  always feels alive when in view.
 *
 *  Reduced-motion: skip the loop, paint the final ready state.
 * ───────────────────────────────────────────────────────────────── */

export function SecureSection() {
  const reduce = useReducedMotion();

  const fadeIn = (delay = 0) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 28 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true, amount: 0.18, margin: "0px 0px -10% 0px" },
          transition: {
            duration: 0.7,
            delay,
            ease: [0.22, 1, 0.36, 1] as const,
          },
        };

  return (
    <section
      id="secure"
      className="relative z-10 grid grid-cols-1 gap-10 px-5 pb-16 pt-12 sm:gap-14 sm:px-10 sm:pb-24 sm:pt-20 lg:grid-cols-12 lg:items-center lg:gap-12 lg:pb-28 lg:pt-24"
    >
      <div className="lg:col-span-5 lg:self-center">
        <motion.h2
          {...fadeIn(0.05)}
          className="landing-section-heading mt-5 text-[clamp(2.25rem,6.5vw,5rem)] font-medium leading-[0.9] tracking-[-0.04em] text-white sm:mt-7"
        >
          Lose a device.
          <br />
          Keep your <span className="italic-skew">wallet</span>.
        </motion.h2>

        <motion.p
          {...fadeIn(0.12)}
          className="mt-6 max-w-xl text-[15px] leading-relaxed text-white/60 sm:mt-7 sm:text-base"
        >
          Split your signing key across the devices you already trust. Lose
          one, recover with any threshold of the rest.
        </motion.p>

        <motion.ul
          {...fadeIn(0.18)}
          className="mt-7 flex flex-col gap-3 sm:mt-9"
        >
          {[
            "One key across phone, laptop, passkey, and Ledger.",
            "Recover with any threshold you set.",
            "No seed phrase. No single point of failure.",
          ].map((line) => (
            <li
              key={line}
              className="flex items-start gap-3 text-[14px] leading-relaxed text-white/75 sm:text-[15px]"
            >
              <span className="mt-1 inline-flex h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#ccff00] shadow-[0_0_6px_rgba(204,255,0,0.5)]" />
              <span>{line}</span>
            </li>
          ))}
        </motion.ul>

        <motion.div
          {...fadeIn(0.24)}
          className="mt-8 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 font-mono-tech text-[10px] uppercase tracking-[0.24em] text-white/55 sm:mt-10"
        >
          Personal-recovery vault · devnet pre-alpha
        </motion.div>
      </div>

      <motion.div
        {...fadeIn(0.2)}
        className="relative lg:col-span-7 lg:self-center"
      >
        <SecureVaultMockup />
      </motion.div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────
 *  Vault mockup. Self-contained: hosts its own phase state machine
 *  that cycles Sealed → Approving (×2) → Threshold met → Ready hold,
 *  then loops. Phase indices drive every animated piece below.
 * ───────────────────────────────────────────────────────────────── */
