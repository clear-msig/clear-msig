import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  Check,
  Fingerprint,
  ShieldCheck,
  X,
} from "lucide-react";
import { ClearCMark } from "@/components/landing/ClearCMark";
import { LandingReveal } from "@/components/landing/LandingReveal";
import s from "./LandingPage.module.css";
import { ChainMarquee } from "../ui/home/ChainMarquee";
import { DecodeDevice } from "../ui/DecodeDevice";
import { ApprovalLab } from "../ui/ApprovalLab";

const COMPARISON: readonly { row: string; blind: string; clear: string }[] = [
  {
    row: "What you sign",
    blind: "Hex bytes, or a contract call you decode yourself.",
    clear: "A plain sentence: the action, amount, destination and network.",
  },
  {
    row: "What every approver sees",
    blind: "Whatever each wallet and device happens to display.",
    clear: "One canonical document and one hash, the same for everyone.",
  },
  {
    row: "If the interface lies",
    blind: "You approve whatever bytes arrive.",
    clear:
      "The program recomputes the payload and rejects a request that does not match what was approved.",
  },
  {
    row: "Rules",
    blind: "Trust the screen that built the request.",
    clear: "Threshold, policy and timelock are checked by the program before anything runs.",
  },
  {
    row: "Expiry and replay",
    blind: "Usually not visible in the prompt.",
    clear: "Every vote is bound to the request, the requester and an expiry.",
  },
];

const PRODUCTS = [
  {
    n: "01",
    href: "/choose",
    title: "People & teams",
    description: "Shared wallets, readable proposals and approval rules.",
    state: "Devnet preview",
  },
  {
    n: "02",
    href: "/secure",
    title: "Your recovery plan",
    description: "Explore personal recovery vaults and threshold recovery.",
    state: "Pre-alpha",
  },
  {
    n: "03",
    href: "/agent",
    title: "Bounded agents",
    description: "Review the policies and approvals around an agent’s requests.",
    state: "External execution gated",
  },
] as const;

export default function HomePage() {
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
        <section className={s.hero} aria-labelledby="hero-title">
          <div className={s.heroCopy}>
            <p className={s.eyebrow}>
              <span aria-hidden="true" /> Devnet preview · Test funds only
            </p>
            <h1 id="hero-title">
              Sign intents.
              <br />
              <em>Not hex.</em>
            </h1>
            <p className={s.tagline}>
              Every approval. <em>Crystal clear.</em>
            </p>
            <p className={s.intro}>
              A shared wallet where every approver reads the same plain
              sentence the chain enforces. No decoding bytes. No trusting a
              screen.
            </p>
            <div className={s.actions}>
              <Link className={s.primary} href="/choose">
                Explore ClearSig <ArrowRight size={19} aria-hidden="true" />
              </Link>
              <a className={s.secondary} href="#approval">
                Try an approval <ArrowDown size={16} aria-hidden="true" />
              </a>
            </div>
          </div>
          <div className={s.heroVisual}>
            <DecodeDevice />
            <p className={s.caption}>
              Illustrative example. No transaction or signature.
            </p>
          </div>
        </section>

        <ChainMarquee />

        <section id="approval" className={s.labSection} aria-labelledby="lab-title">
          <LandingReveal>
            <div className={s.sectionHeading}>
              <p className={s.kicker}>SEE IT. TOUCH IT.</p>
              <h2 id="lab-title">
                Know what happens.
                <br />
                <span>Before it happens.</span>
              </h2>
              <p>
                This is the approval screen. Approve as a teammate, then try to
                fool it with a look-alike address.
              </p>
            </div>
          </LandingReveal>
          <LandingReveal>
            <ApprovalLab />
          </LandingReveal>
          <p className={s.deviceRow}>
            <Fingerprint size={17} aria-hidden="true" /> Your device. Your
            approval. Readable intent, explicit rules, shared control.
          </p>
        </section>

        <section
          id="how-it-works"
          className={s.chapters}
          aria-labelledby="chapters-title"
        >
          <LandingReveal>
            <div className={s.sectionHeading}>
              <p className={s.kicker}>FROM REQUEST TO DECISION</p>
              <h2 id="chapters-title">
                Every detail.
                <br />
                <span>Before the decision.</span>
              </h2>
            </div>
          </LandingReveal>
          <div className={s.chapterGrid}>
            <LandingReveal>
              <article className={s.chapter}>
                <span className={s.chapterNumber}>01</span>
                <h3>Understand the action.</h3>
                <p>
                  See what moves, how much, and where it goes. A readable
                  request gives every owner the same facts.
                </p>
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
                <h3>Keep people in control.</h3>
                <p>
                  One approval is in. A second owner is still needed. The
                  threshold is visible, and no one has to guess who decides.
                </p>
                <div className={s.evidence}>
                  <span>THE THRESHOLD</span>
                  <strong>2 of 3</strong>
                  <p>Owners required to approve</p>
                </div>
              </article>
            </LandingReveal>
          </div>
        </section>

        <section className={s.compare} aria-labelledby="compare-title">
          <LandingReveal>
            <div className={s.sectionHeading}>
              <p className={s.kicker}>WHY IT MATTERS</p>
              <h2 id="compare-title">
                Signing bytes is a leap of faith.
                <br />
                <span>Signing a sentence is a decision.</span>
              </h2>
            </div>
          </LandingReveal>
          <LandingReveal>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col"><span className={s.srOnly}>Question</span></th>
                  <th scope="col">Signing raw bytes</th>
                  <th scope="col">ClearSig</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((r) => (
                  <tr key={r.row}>
                    <th scope="row">{r.row}</th>
                    <td data-label="Signing raw bytes">
                      <X size={15} aria-hidden="true" /> {r.blind}
                    </td>
                    <td data-label="ClearSig">
                      <Check size={15} aria-hidden="true" /> {r.clear}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={s.fine}>
              Pre-alpha. Devnet only, not audited, and the Ika signer is a
              single mock. Do not use with real funds.
            </p>
          </LandingReveal>
        </section>

        <section
          id="products"
          className={s.products}
          aria-labelledby="products-title"
        >
          <LandingReveal>
            <div className={s.sectionHeading}>
              <p className={s.kicker}>ONE CLEAR FOUNDATION</p>
              <h2 id="products-title">
                Shared control.
                <br />
                <span>Different reasons.</span>
              </h2>
            </div>
          </LandingReveal>
          <div className={s.productList}>
            {PRODUCTS.map((p) => (
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
            <h2>
              Read it before
              <br />
              <em>you sign it.</em>
            </h2>
            <p>
              Explore the security model, supported paths and current
              limitations before you start.
            </p>
            <div className={s.actions}>
              <Link className={s.primary} href="/choose">
                Explore ClearSig <ArrowRight size={19} aria-hidden="true" />
              </Link>
              <Link className={s.secondary} href="/security">
                Read the security overview{" "}
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
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
