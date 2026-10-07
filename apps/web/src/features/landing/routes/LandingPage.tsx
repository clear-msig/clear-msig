"use client";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  Check,
  Fingerprint,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { ClearCMark } from "@/components/landing/ClearCMark";
import { LandingReveal } from "@/components/landing/LandingReveal";
import s from "./LandingPage.module.css";
import { ChainMarquee } from "../ui/home/ChainMarquee";
import { SignatureStage } from "../ui/SignatureStage";
import { LandingSectionNav } from "../ui/LandingSectionNav";

export default function HomePage() {
  const [reviewed, setReviewed] = useState(false);
  return (
    <div className={`${s.page} public-brand-surface`}>
      <a href="#landing-content" className={s.skip}>
        Skip to content
      </a>
      <header className={s.header}>
        <Link href="/" className={s.brand} aria-label="ClearSig home">
          <ClearCMark size={30} alt="" variant="on-dark" />
          ClearSig
        </Link>
        <nav aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#products">Products</a>
          <Link href="/security">Security</Link>
        </nav>
        <Link className={s.headerAction} href="/connect">
          Sign in <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </header>
      <main id="landing-content" tabIndex={-1}>
        <section
          id="overview"
          className={`${s.hero} ${s.cinematicHero}`}
          aria-labelledby="hero-title"
        >
          <div className={s.stageTopline}>
            <span>01 / SHARED CONTROL</span>
            <span>Devnet preview · Test funds only</span>
          </div>
          <SignatureStage />
          <h1 id="hero-title">
            <span>Sign intents.</span> <span>Not hex.</span>
          </h1>
          <div className={s.stagePrinciples} aria-label="ClearSig principles">
            <span>YOUR INTENT</span>
            <span>YOUR RULES</span>
            <span>YOUR PEOPLE</span>
          </div>
          <div className={s.stageFooter}>
            <div className={s.stageActions}>
              <Link className={s.stagePrimary} href="/choose">
                Explore ClearSig <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <a href="#approval">
                See an approval <ArrowDown size={14} aria-hidden="true" />
              </a>
            </div>
            <p>Shared wallets. Readable approvals.</p>
          </div>
        </section>
        <LandingSectionNav />
        <LandingReveal className={s.chapterReveal}>
          <div className={s.chapterDivider}>
            <span>FROM INTENT TO APPROVAL</span>
          </div>
        </LandingReveal>
        <LandingReveal>
          <div className={s.demoHeading}>
            <p className={s.eyebrow}>01 / UNDERSTAND THE REQUEST</p>
            <h2>
              Every approval.
              <br />
              <span>Crystal clear.</span>
            </h2>
            <p>
              A closer look at a request. Clear details, visible rules and an
              explicit decision.
            </p>
          </div>
        </LandingReveal>
        <LandingReveal>
          <section
            id="approval"
            className={s.instrument}
            aria-labelledby="approval-title"
          >
            <div className={s.instrumentBar}>
              <span>
                <i aria-hidden="true" />
                OPERATIONS WALLET
              </span>
              <span>Illustrative demo · no transaction</span>
            </div>
            <div className={s.workspace}>
              <div className={s.actionPane}>
                <div className={s.paneTitle}>
                  <span>01 / THE ACTION</span>
                  <span className={s.network}>Solana devnet</span>
                </div>
                <h2 id="approval-title">Send to Operations vault</h2>
                <p className={s.amount}>
                  5<span>SOL</span>
                </p>
                <div className={s.destination}>
                  <span className={s.destinationIcon}>
                    <ArrowRight size={20} aria-hidden="true" />
                  </span>
                  <div>
                    <strong>Operations vault</strong>
                    <span>Saved destination · example</span>
                  </div>
                  <span className={s.destinationTag}>Transfer</span>
                </div>
                <div className={s.actionNote}>
                  <LockKeyhole size={15} aria-hidden="true" />
                  <span>
                    These are the details owners review before signing.
                  </span>
                </div>
              </div>
              <div className={s.reviewPane}>
                <div className={s.paneTitle}>
                  <span>02 / THE RULES</span>
                  <ShieldCheck size={17} aria-hidden="true" />
                </div>
                <div className={s.ruleStatus}>
                  <Check size={15} aria-hidden="true" /> Policy checks passed
                </div>
                <div className={s.ruleLine}>
                  <span>Transfer limit</span>
                  <strong>5 of 10 SOL</strong>
                </div>
                <div
                  className={s.meter}
                  role="img"
                  aria-label="This transfer uses 5 of the 10 SOL limit"
                >
                  <span />
                </div>
                <div className={s.ruleLine}>
                  <span>Destination</span>
                  <strong>Allowed</strong>
                </div>
                <div className={s.signerHeader}>
                  <span>03 / THE PEOPLE</span>
                  <span>2 required</span>
                </div>
                <div className={s.signers}>
                  <div className={s.avatar}>
                    S
                    <span aria-label="Approved">
                      <Check size={10} />
                    </span>
                  </div>
                  <div className={s.avatar}>
                    M
                    {reviewed && (
                      <span aria-label="Demo approval">
                        <Check size={10} />
                      </span>
                    )}
                  </div>
                  <div className={s.avatar}>A</div>
                  <div className={s.signerCount} aria-live="polite">
                    <strong>
                      {reviewed ? "2" : "1"} of 2 required approvals
                    </strong>
                    <span>
                      {reviewed
                        ? "3 members · threshold met in demo"
                        : "3 members · 1 more needed"}
                    </span>
                  </div>
                </div>
                <button
                  className={s.demoButton}
                  onClick={() => setReviewed(!reviewed)}
                >
                  {reviewed ? "Reset demonstration" : "Try the approval demo"}
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
                <p className={s.demoNote}>
                  Local demonstration. No wallet or signature requested.
                </p>
              </div>
            </div>
            <div className={s.deviceRow}>
              <span>
                <Fingerprint size={17} aria-hidden="true" /> Your device. Your
                approval.
              </span>
              <span>Readable intent / Explicit rules / Shared control</span>
            </div>
          </section>
        </LandingReveal>
        <LandingReveal className={s.chapterReveal}>
          <div className={s.chapterDivider}>
            <span>THE DECISION PATH</span>
          </div>
        </LandingReveal>
        <section
          id="how-it-works"
          className={s.chapters}
          aria-labelledby="chapters-title"
        >
          <LandingReveal>
            <div className={s.sectionHeading}>
              <p className={s.eyebrow}>FROM REQUEST TO DECISION</p>
              <h2 id="chapters-title">
                Every detail.
                <br />
                <span>Before the decision.</span>
              </h2>
              <p>
                Follow the same 5 SOL request through the checks that matter.
              </p>
            </div>
          </LandingReveal>
          <div className={s.chapterRows}>
            <LandingReveal>
              <article className={s.chapter}>
                <span className={s.chapterNumber}>01</span>
                <div>
                  <h3>Understand the action.</h3>
                  <p>
                    See what moves, how much, and where it goes. A readable
                    request gives every owner the same facts.
                  </p>
                </div>
                <div className={s.evidence}>
                  <span>THE REQUEST</span>
                  <strong>
                    5 SOL <ArrowRight size={20} aria-hidden="true" />
                  </strong>
                  <p>Operations vault</p>
                </div>
              </article>
            </LandingReveal>
            <LandingReveal>
              <article className={s.chapter}>
                <span className={s.chapterNumber}>02</span>
                <div>
                  <h3>Check the boundaries.</h3>
                  <p>
                    The request is checked against the applicable policy. An
                    approval never makes an out-of-policy action safe.
                  </p>
                  <details>
                    <summary>What if the amount exceeds the limit?</summary>
                    <p>
                      A 12 SOL request exceeds this 10 SOL policy and must be
                      blocked. This example doesn’t change your wallet or its
                      rules.
                    </p>
                  </details>
                </div>
                <div className={s.evidence}>
                  <span>THE LIMIT</span>
                  <strong>
                    5 / 10 <small>SOL</small>
                  </strong>
                  <p>
                    <Check size={14} aria-hidden="true" /> Within the allowed
                    amount
                  </p>
                </div>
              </article>
            </LandingReveal>
            <LandingReveal>
              <article className={s.chapter}>
                <span className={s.chapterNumber}>03</span>
                <div>
                  <h3>Keep people in control.</h3>
                  <p>
                    One approval is in. A second owner is still needed. The
                    threshold is visible, and no one has to guess who decides.
                  </p>
                </div>
                <div className={s.evidence}>
                  <span>THE THRESHOLD</span>
                  <strong>2 of 3</strong>
                  <p>Owners required to approve</p>
                </div>
              </article>
            </LandingReveal>
          </div>
        </section>
        <ChainMarquee />
        <LandingReveal className={s.chapterReveal}>
          <div className={s.chapterDivider}>
            <span>FIND YOUR STARTING POINT</span>
          </div>
        </LandingReveal>
        <section
          id="products"
          className={s.products}
          aria-labelledby="products-title"
        >
          <LandingReveal>
            <div className={s.sectionHeading}>
              <p className={s.eyebrow}>ONE CLEAR FOUNDATION</p>
              <h2 id="products-title">
                Shared control.
                <br />
                <span>Different reasons.</span>
              </h2>
            </div>
          </LandingReveal>
          <div className={s.productList}>
            {[
              {
                n: "01",
                href: "/choose",
                title: "People & teams",
                description:
                  "Shared wallets, readable proposals and approval rules.",
                state: "Devnet preview",
              },
              {
                n: "02",
                href: "/secure",
                title: "Your recovery plan",
                description:
                  "Explore personal recovery vaults and threshold recovery.",
                state: "Pre-alpha",
              },
              {
                n: "03",
                href: "/agent",
                title: "Bounded agents",
                description:
                  "Review the policies and approvals around an agent’s requests.",
                state: "External execution gated",
              },
            ].map((p) => (
              <LandingReveal key={p.n}>
                <Link href={p.href}>
                  <span className={s.productIndex}>{p.n}</span>
                  <div>
                    <h3>{p.title}</h3>
                    <p>{p.description}</p>
                  </div>
                  <span className={s.productState}>{p.state}</span>
                  <ArrowRight aria-hidden="true" />
                </Link>
              </LandingReveal>
            ))}
          </div>
        </section>
        <LandingReveal>
          <section className={s.closing}>
            <ShieldCheck size={26} aria-hidden="true" />
            <h2>Clarity is part of control.</h2>
            <p>
              Explore the security model, supported paths and current
              limitations before you start.
            </p>
            <Link className={s.secondary} href="/security">
              Read the security overview{" "}
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </section>
        </LandingReveal>
      </main>
      <footer className={s.footer}>
        <Link href="/" className={s.brand}>
          <ClearCMark size={25} alt="" variant="on-dark" />
          ClearSig
        </Link>
        <p>Early preview. Test networks only.</p>
        <div>
          <Link href="/privacy">Privacy</Link>
          <Link href="/security">Security</Link>
          <a href="mailto:info@clearsig.xyz">Contact</a>
        </div>
        <span>© 2026 ClearSig</span>
      </footer>
    </div>
  );
}
