"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, Bot, Check, FileText, Network, ReceiptText, ShieldCheck, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { FadeInFn } from "./types";
import { CHAINS } from "@/components/landing/ChainLogos";

type ControlCard = {
  title: string;
  signal: string;
  detail: string;
  Icon: LucideIcon;
  className?: string;
  accent?: boolean;
  chainStrip?: boolean;
};

export function Bento({ fadeIn }: { fadeIn: FadeInFn }) {
  const controlCards: ControlCard[] = [
    {
      title: "Intent",
      signal: "Readable",
      detail: "5 SOL to Ops vault.",
      Icon: ReceiptText,
      accent: true,
    },
    {
      title: "Rules",
      signal: "$500 cap",
      detail: "Limit, expiry, device.",
      Icon: ShieldCheck,
    },
    {
      title: "People",
      signal: "2 / 3 signed",
      detail: "Approvers stay visible.",
      Icon: Users,
    },
    {
      title: "Chains",
      signal: "Native",
      detail: "Same policy, every route.",
      Icon: Network,
      chainStrip: true,
    },
    {
      title: "Agents",
      signal: "Bounded",
      detail: "No raw key access.",
      Icon: Bot,
    },
    {
      title: "Receipt",
      signal: "Passed",
      detail: "Proof after signing.",
      Icon: FileText,
    },
  ];
  const [activeControl, setActiveControl] = useState(0);
  const [controlDirection, setControlDirection] = useState(1);

  const goToControl = (index: number) => {
    setControlDirection(index > activeControl ? 1 : -1);
    setActiveControl(index);
  };

  const stepControl = (direction: number) => {
    setControlDirection(direction);
    setActiveControl((current) => (current + direction + controlCards.length) % controlCards.length);
  };

  return (
    <section
      id="bento"
      className="relative z-10 overflow-hidden px-5 pb-16 pt-8 sm:px-10 sm:pb-28 sm:pt-12 lg:pb-32"
    >
      <div className="lg:grid lg:grid-cols-[0.68fr_1.32fr] lg:items-center lg:gap-14">
        <motion.div {...fadeIn(0)} className="mb-8 max-w-3xl text-center sm:mb-10 md:text-left lg:mb-0">
          <h2 className="landing-section-heading mt-3 max-w-2xl text-[clamp(1.75rem,4.5vw,3.5rem)] font-light leading-[1.05] tracking-[-0.03em] text-white sm:tracking-[-0.04em]">
            One control layer
            <br />
            <span className="text-white/40">for every action.</span>
          </h2>
          <span className="mx-auto mt-6 block h-1 w-14 rounded-full bg-[#ccff00] md:mx-0" />
          <p className="mx-auto mt-6 max-w-sm text-sm leading-relaxed text-white/52 sm:text-base md:mx-0">
            Intent enters. Policy checks. Owners approve. ClearSig executes.
          </p>
        </motion.div>

        <div>
          <ControlLayerStack
            cards={controlCards}
            activeIndex={activeControl}
            direction={controlDirection}
            onNext={() => stepControl(1)}
            onPrev={() => stepControl(-1)}
            onSelect={goToControl}
          />

          <div className="hidden gap-4 md:grid md:grid-cols-2 lg:hidden">
            {controlCards.map((card, index) => (
              <ControlLayerCard
                key={card.title}
                {...card}
                fadeIn={fadeIn}
                delay={0.04 + index * 0.04}
              />
            ))}
          </div>

          <ControlLayerDesktopCluster fadeIn={fadeIn} />
        </div>
      </div>
    </section>
  );
}

function ControlLayerDesktopCluster({ fadeIn }: { fadeIn: FadeInFn }) {
  const desktopCards: ControlCard[] = [
    {
      title: "Readable intent",
      signal: "5 SOL",
      detail: "Amount, route, destination.",
      Icon: ReceiptText,
      accent: true,
    },
    {
      title: "Policy guard",
      signal: "$500 cap",
      detail: "Limits and device checks.",
      Icon: ShieldCheck,
    },
    {
      title: "People + agents",
      signal: "2 / 3",
      detail: "Owners approve. Agents stay bounded.",
      Icon: Users,
    },
    {
      title: "Native routes",
      signal: "5 chains",
      detail: "One approval surface.",
      Icon: Network,
      chainStrip: true,
    },
  ];
  const positions = [
    "left-[17%] top-0 w-[16rem] xl:w-[17.5rem]",
    "right-0 top-[13%] w-[16rem] xl:w-[17.5rem]",
    "left-[17%] bottom-[8%] w-[16rem] xl:w-[17.5rem]",
    "right-0 bottom-0 w-[16rem] xl:w-[17.5rem]",
  ];

  return (
    <motion.div
      {...fadeIn(0.08)}
      className="relative hidden min-h-[36rem] lg:block"
    >
      <div
        aria-hidden="true"
        className="absolute left-[28%] top-[7%] h-[30rem] w-[30rem] rounded-full bg-[#171a16]"
      />
      <div
        aria-hidden="true"
        className="absolute left-[36%] top-[18%] h-[18rem] w-[18rem] rounded-full bg-[#1d2515]"
      />
      <div
        aria-hidden="true"
        className="absolute left-[12%] top-[47%] h-14 w-14 rounded-full bg-[#ccff00]"
      />
      <div
        aria-hidden="true"
        className="absolute left-[18%] top-[calc(47%+1.7rem)] h-px w-[17%] bg-[#ccff00]/62"
      />

      {desktopCards.map((card, index) => (
        <DesktopControlCard
          key={card.title}
          card={card}
          className={positions[index]}
        />
      ))}
    </motion.div>
  );
}

function DesktopControlCard({
  card,
  className,
}: {
  card: ControlCard;
  className: string;
}) {
  return (
    <motion.article
      whileHover={{ y: -8, scale: 1.02 }}
      transition={{ type: "spring", stiffness: 240, damping: 24 }}
      className={
        "absolute min-h-[12.4rem] rounded-[1.4rem] p-5 shadow-[0_32px_76px_-44px_rgba(0,0,0,0.95)] " +
        (card.accent
          ? "bg-[#ccff00] text-black "
          : "bg-[#101311] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] ") +
        className
      }
    >
      <ControlLayerCardBody {...card} compact />
    </motion.article>
  );
}

function ControlLayerStack({
  cards,
  activeIndex,
  direction,
  onNext,
  onPrev,
  onSelect,
}: {
  cards: ControlCard[];
  activeIndex: number;
  direction: number;
  onNext: () => void;
  onPrev: () => void;
  onSelect: (index: number) => void;
}) {
  const activeCard = cards[activeIndex];

  return (
    <div className="md:hidden">
      <div className="relative min-h-[16rem]">
        <div className="absolute inset-x-7 top-8 h-[13rem] rounded-[1.35rem] bg-[#151914] opacity-55" />
        <div className="absolute inset-x-4 top-4 h-[13.75rem] rounded-[1.35rem] bg-[#111512] opacity-80" />
        <AnimatePresence initial={false} custom={direction} mode="wait">
          <motion.article
            key={activeCard.title}
            custom={direction}
            initial={{ opacity: 0, x: direction * 64, rotateY: direction * 10, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, rotateY: 0, scale: 1 }}
            exit={{ opacity: 0, x: direction * -64, rotateY: direction * -10, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 260, damping: 28 }}
            className={
              "relative z-10 min-h-[14.75rem] rounded-[1.35rem] p-5 shadow-[0_24px_80px_-58px_rgba(0,0,0,0.95)] " +
              (activeCard.accent
                ? "bg-[#ccff00] text-black"
                : "bg-[#101311] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]")
            }
            style={{ transformStyle: "preserve-3d" }}
          >
            <ControlLayerCardBody {...activeCard} />
          </motion.article>
        </AnimatePresence>
      </div>

      <div className="mt-5 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={onPrev}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-[#101311] text-white/72 transition-colors hover:text-[#ccff00]"
          aria-label="Previous control card"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" strokeWidth={2.4} />
        </button>

        <div className="flex items-center gap-2">
          {cards.map((card, index) => (
            <button
              key={card.title}
              type="button"
              onClick={() => onSelect(index)}
              className={
                "h-2.5 rounded-full transition-all duration-300 " +
                (index === activeIndex ? "w-7 bg-[#ccff00]" : "w-2.5 bg-white/18")
              }
              aria-label={`Show ${card.title}`}
              aria-current={index === activeIndex}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={onNext}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-[#ccff00] text-black transition-transform hover:scale-105"
          aria-label="Next control card"
        >
          <ArrowRight className="h-4 w-4" aria-hidden="true" strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}

function ControlLayerCard({
  fadeIn,
  delay,
  ...card
}: ControlCard & {
  fadeIn: FadeInFn;
  delay: number;
}) {
  return (
    <motion.article
      {...fadeIn(delay)}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.985 }}
      className={
        "min-h-[13.5rem] rounded-[1.35rem] p-5 shadow-[0_24px_80px_-58px_rgba(0,0,0,0.95)] transition-transform duration-300 sm:p-6 " +
        (card.accent
          ? "bg-[#ccff00] text-black "
          : "bg-[#101311] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] ") +
        (card.className ?? "")
      }
    >
      <ControlLayerCardBody {...card} />
    </motion.article>
  );
}

function ControlLayerCardBody({
  title,
  signal,
  detail,
  Icon,
  accent,
  chainStrip,
  compact,
}: ControlCard & { compact?: boolean }) {
  const routeChains = CHAINS.filter((chain) =>
    ["sol", "eth", "btc", "zec", "hyperliquid"].includes(chain.key),
  );

  return (
    <div className={"flex h-full flex-col justify-between " + (compact ? "gap-6" : "gap-8")}>
      <div className="flex items-center justify-between gap-4">
        <span
          className={
            (compact
              ? "flex h-10 w-10 items-center justify-center rounded-2xl "
              : "flex h-11 w-11 items-center justify-center rounded-2xl ") +
            (accent ? "bg-black text-[#ccff00]" : "bg-[#ccff00] text-black")
          }
        >
          <Icon className={compact ? "h-[18px] w-[18px]" : "h-5 w-5"} aria-hidden="true" strokeWidth={2.2} />
        </span>
        <span
          className={
            "text-right text-[11px] font-semibold uppercase tracking-[0.16em] " +
            (accent ? "text-black/58" : "text-[#ccff00]")
          }
        >
          {signal}
        </span>
      </div>

      <div>
        <h3
          className={
            (compact ? "text-xl" : "text-2xl") +
            " font-semibold tracking-[-0.04em] " +
            (accent ? "text-black" : "text-white")
          }
        >
          {title}
        </h3>
        <p
          className={
            "mt-2 max-w-sm leading-relaxed " +
            (compact ? "text-xs " : "text-sm ") +
            (accent ? "text-black/64" : "text-white/52")
          }
        >
          {detail}
        </p>
        {chainStrip ? (
          <div className="mt-5 flex items-center gap-3">
            {routeChains.map(({ key, Logo }) => (
              <span
                key={key}
                className={
                  (compact ? "h-8 w-8 " : "h-9 w-9 ") +
                  "flex items-center justify-center rounded-xl bg-[#0b0e0d]"
                }
              >
                <Logo size={compact ? 19 : 22} />
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function BentoLargeBars() {
  // Animated approval cycle. The card cycles through 4 states on a
  // ~6.4s loop while in view, so a passing reader actually sees the
  // approval flow happen, not a still life:
  //
  //   step 0 - Sarah signing
  //   step 1 - Sarah signed,  Mark signing
  //   step 2 - Sarah + Mark signed,  Ada signing
  //   step 3 - all signed,  "Sent" pill appears (held longer)
  //   → loops back to 0
  //
  // The progress bar width is bound to signedCount so it physically
  // fills as the count climbs. The check-badge appearance per row is
  // gated by AnimatePresence so each badge pops in with a spring at
  // the moment its row flips from signing → signed.
  //
  // useInView gates the cycle so the animation only runs while the
  // card is actually on screen - no offscreen tick churn. Reduced-
  // motion users get pinned to step 3 (the "fully signed" final
  // state) so the card still tells the story.

  const reduce = useReducedMotion();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inView = useInView(containerRef, { amount: 0.35, once: false });
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (reduce) {
      setStep(3);
      return;
    }
    if (!inView) return;
    // Hold the "Sent" frame slightly longer than the others so the
    // resolution lands - feels rewarding instead of a flash.
    const STEP_HOLD_MS = [1500, 1500, 1500, 2400];
    const t = setTimeout(
      () => setStep((s) => (s + 1) % 4),
      STEP_HOLD_MS[step],
    );
    return () => clearTimeout(t);
  }, [step, inView, reduce]);

  const approvers = [
    { initial: "S", name: "Sarah", grad: "from-[#ff8a4c] to-[#ff5a8a]" },
    { initial: "M", name: "Mark", grad: "from-[#7c4dff] to-[#4dc3ff]" },
    { initial: "A", name: "Ada", grad: "from-[#10b981] to-[#34d399]" },
  ];

  function rowState(i: number): "pending" | "signing" | "signed" {
    if (step === 3) return "signed";
    if (i < step) return "signed";
    if (i === step) return "signing";
    return "pending";
  }

  const signedCount = step === 3 ? 3 : step;
  const progressPct = (signedCount / 3) * 100;

  return (
    <div ref={containerRef}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono-tech text-[10px] uppercase tracking-[0.24em] text-white/60">
            approvals
          </span>
        </div>
        <span className="inline-flex items-center font-mono-tech text-[10px] uppercase tracking-[0.24em] text-[#ccff00]">
          live
        </span>
      </div>

      {/* Plain-English signed sentence - the literal thing the
          approvers see in their wallet. */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] as const }}
        className="receipt-scan product-field relative mt-6 overflow-hidden rounded-xl p-5 sm:p-6"
      >
        <div className="relative flex items-center">
          <span className="font-mono-tech text-[9px] uppercase tracking-[0.22em] text-white/45">
            What you&apos;re signing
          </span>
        </div>
        <p className="relative mt-3 text-[clamp(1.05rem,2.4vw,1.4rem)] font-light leading-snug tracking-[-0.01em] text-white">
          &ldquo;Agent may move{" "}
          <span className="amount-glow font-medium text-[#ccff00]">$500</span>{" "}
          on <span className="font-medium">Hyperliquid testnet</span>,
          <br className="hidden sm:block" /> expires{" "}
          <span className="font-medium">Jan 1, 2026</span>.&rdquo;
        </p>
      </motion.div>

      {/* Approver roster. Each row's right slot swaps between
          pending / signing / signed based on `step`. AnimatePresence
          handles the transitions so badges pop and dots fade. */}
      <ul className="mt-5 space-y-2.5">
        {approvers.map((a, i) => {
          const state = rowState(i);
          const dim = state === "pending";
          return (
            <motion.li
              key={a.name}
              animate={{
                borderColor:
                  state === "signing"
                    ? "rgba(204, 255, 0,0.22)"
                    : "rgba(255,255,255,0.04)",
                backgroundColor:
                  state === "signing"
                    ? "rgba(204, 255, 0,0.04)"
                    : "rgba(255,255,255,0.015)",
              }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] as const }}
              className="product-field flex items-center gap-3 rounded-xl px-3 py-2.5"
            >
              <motion.span
                animate={{ opacity: dim ? 0.45 : 1 }}
                transition={{ duration: 0.4 }}
                className={
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-[12px] font-semibold text-white " +
                  a.grad
                }
              >
                {a.initial}
              </motion.span>
              <motion.span
                animate={{ color: dim ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.92)" }}
                transition={{ duration: 0.4 }}
                className="text-[13px] font-medium"
              >
                {a.name}
              </motion.span>
              <div className="ml-auto flex items-center">
                <AnimatePresence mode="wait" initial={false}>
                  {state === "pending" && (
                    <motion.span
                      key="pending"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.25 }}
                      className="font-mono-tech text-[10px] uppercase tracking-[0.18em] text-white/30"
                    >
                      waiting
                    </motion.span>
                  )}
                  {state === "signing" && (
                    <motion.span
                      key="signing"
                      initial={{ opacity: 0, x: 4 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -4 }}
                      transition={{ duration: 0.3 }}
                      className="inline-flex items-center gap-2 text-[11px] font-mono-tech uppercase tracking-[0.18em] text-[#ccff00]"
                    >
                      signing
                      <span className="inline-flex items-center gap-1">
                        <span className="signing-dot h-1 w-1 rounded-full bg-[#ccff00]" />
                        <span className="signing-dot h-1 w-1 rounded-full bg-[#ccff00]" />
                        <span className="signing-dot h-1 w-1 rounded-full bg-[#ccff00]" />
                      </span>
                    </motion.span>
                  )}
                  {state === "signed" && (
                    <motion.span
                      key="signed"
                      initial={{ opacity: 0, x: 4 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="inline-flex items-center gap-2 text-[11px] text-white/55"
                    >
                      <span className="font-mono-tech tracking-[0.06em]">
                        signed
                      </span>
                      <motion.span
                        initial={{ scale: 0, rotate: -12 }}
                        animate={{ scale: 1, rotate: 0 }}
                        transition={{
                          type: "spring" as const,
                          damping: 11,
                          stiffness: 320,
                        }}
                        className="flex h-5 w-5 items-center justify-center rounded-full bg-[#ccff00] text-black"
                      >
                        <Check className="h-3 w-3" strokeWidth={3.2} />
                      </motion.span>
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            </motion.li>
          );
        })}
      </ul>

      {/* Progress bar - width animated to signedCount/3. */}
      <div className="mt-5 h-[5px] w-full overflow-hidden rounded-full bg-white/[0.05]">
        <motion.div
          className="h-full rounded-full bg-[#ccff00]"
          initial={{ width: "0%" }}
          animate={{ width: `${progressPct}%` }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] as const }}
        />
      </div>

      {/* "Sent" success pill - only at step 3. Lands with a spring,
          slides out cleanly when the cycle resets. */}
      <div className="mt-4 h-9">
        <AnimatePresence>
          {step === 3 && (
            <motion.div
              key="sent"
              initial={{ opacity: 0, y: 8, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.96 }}
              transition={{
                type: "spring" as const,
                damping: 16,
                stiffness: 260,
              }}
              className="inline-flex items-center gap-2 rounded-full border border-[#ccff00]/35 bg-[#ccff00]/[0.08] px-3 py-1.5"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#ccff00] text-black">
                <Check className="h-3 w-3" strokeWidth={3.2} />
              </span>
              <span className="font-mono-tech text-[10px] uppercase tracking-[0.2em] text-[#ccff00]">
                sent · all approved
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-5 max-w-md">
        <h3 className="text-3xl font-light leading-[1.05] tracking-[-0.02em] text-white sm:text-4xl">
          Approvals,
          <br />
          <span className="text-white/40">in plain English.</span>
        </h3>
        <p className="mt-4 text-sm leading-relaxed text-white/60">
          Every request reads as a sentence. Members see the policy, amount,
          destination, and expiry before they sign.
        </p>
      </div>

      <div className="mt-6 flex items-center gap-6 border-t border-white/10 pt-4">
        <div>
          {/* Live count. The `key` swap makes framer-motion remount
              on each change so the number pops with a tiny spring. */}
          <motion.div
            key={signedCount}
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{
              type: "spring" as const,
              damping: 14,
              stiffness: 320,
            }}
            className="text-2xl font-light text-white"
          >
            {signedCount}/3
          </motion.div>
          <div className="font-mono-tech text-[9px] uppercase tracking-[0.24em] text-white/40">
            approvals to send
          </div>
        </div>
        <div>
          <div className="text-2xl font-light text-white">∞</div>
          <div className="font-mono-tech text-[9px] uppercase tracking-[0.24em] text-white/40">
            members
          </div>
        </div>
      </div>
    </div>
  );
}

function BentoChainSwatches() {
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="font-mono-tech text-[10px] uppercase tracking-[0.24em] text-white/60">
          chains
        </span>
      </div>

      {/* Real brand logos in a tinted square so each chain reads
          instantly. Each row carries a subtle accent ring + tinted
          background using the chain's signature colour, replacing
          the previous gradient swatches. */}
      <div className="mt-6 space-y-2">
        {CHAINS.map(({ key, label, accent, Logo }, i) => (
          <div
            key={key}
            className="flex items-center justify-between border-b border-white/5 pb-2 last:border-b-0 last:pb-0"
            style={{ opacity: 1 - i * 0.04 }}
          >
            <div className="flex items-center gap-3">
              <span
                className="flex h-9 w-9 items-center justify-center rounded-xl ring-1"
                style={{
                  background: `${accent}1a`,
                  borderColor: `${accent}40`,
                  // Use box-shadow for the ring to apply colour vs a
                  // ring-* utility (which expects opacity tokens).
                  boxShadow: `inset 0 0 0 1px ${accent}33`,
                }}
              >
                <Logo size={20} />
              </span>
              <span className="font-mono-tech text-[11px] uppercase tracking-[0.18em] text-white/85">
                {key}
              </span>
            </div>
            <span className="text-[11px] text-white/40">{label}</span>
          </div>
        ))}
      </div>

      <div className="mt-8">
        <h3 className="text-2xl font-light leading-[1.1] tracking-tight text-white">
          One policy.
          <br />
          <span className="text-white/40">Native chains.</span>
        </h3>
        <p className="mt-3 text-[13px] leading-relaxed text-white/60">
          Solana, EVM, Bitcoin, Zcash, and Hyperliquid flows stay under the
          same approval surface.
        </p>
      </div>

      <div className="mt-5 inline-flex items-center rounded-full border border-white/15 px-3 py-1.5">
        <span className="font-mono-tech text-[9px] uppercase tracking-[0.24em] text-white/70">
          Native, not wrapped
        </span>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────
 *  Why Clear - comparison vs regular multisig
 *
 *  Side-by-side rows on md+ (left = regular multisig, right = Clear);
 *  stacks pair-by-pair on mobile so each row's "before vs after"
 *  relationship stays visible without scrolling past a header. Each
 *  card carries its own "Regular multisig" / "Clear" mono chip so a
 *  user landing mid-section never loses orientation.
 * ───────────────────────────────────────────────────────────────── */
