"use client";
import Link from "next/link";
import { ArrowDown, ArrowRight, ShieldCheck } from "lucide-react";
import { LandingReveal } from "@/components/landing/LandingReveal";
import s from "./LandingPage.module.css";
import { ChainMarquee } from "../ui/home/ChainMarquee";
import { SignatureStage } from "../ui/SignatureStage";
import { ApprovalStory } from "../ui/ApprovalStory";
import { SigiGuideProvider, SigiWelcome } from "../ui/SigiGuide";
import { ProductScene } from "../ui/ProductScene";
import { LandingMenu } from "../ui/LandingMenu";
import { LandingResources, LandingFooter } from "../ui/LandingResources";

export default function HomePage() {
  return (
    <SigiGuideProvider>
    <div className={`${s.page} public-brand-surface`}>
      <a href="#landing-content" className={s.skip}>
        Skip to content
      </a>
      <LandingMenu />
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
              <Link id="explore-clearsig" className={s.stagePrimary} href="/choose">
                Explore ClearSig <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <a href="#approval">
                See an approval <ArrowDown size={14} aria-hidden="true" />
              </a>
            </div>
            <p>Shared wallets. Readable approvals.</p>
          </div>
          <SigiWelcome />
        </section>
        <ApprovalStory />
        <LandingReveal><ChainMarquee /></LandingReveal>
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
            <div className={s.sectionHeading} data-reveal-parts>
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
                <Link href={p.href} data-reveal-parts>
                  <ProductScene scene={p.n} />
                  <div className={s.productCopy}>
                    <span className={s.productIndex}>{p.n} / EXPLORE</span>
                    <h3>{p.title}</h3>
                    <p>{p.description}</p>
                    <span className={s.productState}>{p.state}</span>
                    <span className={s.productLink}>
                      Explore {p.title.toLowerCase()} <ArrowRight aria-hidden="true" />
                    </span>
                  </div>
                </Link>
              </LandingReveal>
            ))}
          </div>
        </section>
        <LandingResources />
        <LandingReveal>
          <section className={s.closing} data-reveal-parts>
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
      <LandingFooter />
    </div>
    </SigiGuideProvider>
  );
}
