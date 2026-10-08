import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { SigiReturn } from "./SigiGuide";
import s from "./LandingResources.module.css";

const repo = "https://github.com/clear-msig/clear-msig";
export function LandingResources() {
  return <section id="resources" className={s.resources} aria-labelledby="resources-title">
    <LandingReveal className={s.heading}><p>UNDERSTAND BEFORE YOU START</p><h2 id="resources-title" tabIndex={-1}>The details are<br />part of the product.</h2></LandingReveal>
    <LandingReveal><SigiReturn /></LandingReveal>
    <div className={s.explainers}>
      {[
        { n: "01", title: "Product overview", kind: "FIELD GUIDE", file: "docs/product-overview.md", copy: "A map of shared wallets, readable requests and the paths through ClearSig.", motif: "map" },
        { n: "02", title: "Quickstart & devnet demo", kind: "WORKING NOTES", file: "README.md", copy: "Start with the repository. Explore the setup and devnet demonstration with test funds only.", motif: "steps" },
        { n: "03", title: "Threat model", kind: "BOUNDARIES", file: "SECURITY.md", copy: "Read the trust assumptions, current limitations and security policy before you experiment.", motif: "boundary" },
      ].map((doc, i) => <LandingReveal as="article" order={i} key={doc.n}>
        <a className={s.document} href={`${repo}/blob/main/${doc.file}`} aria-label={`Read ${doc.title.toLowerCase()}`}>
          <div className={s.cover} data-motif={doc.motif} aria-hidden="true"><span>C / REFERENCE {doc.n}</span><div className={s.coverArt}><i /><i /><i /></div><strong>{doc.title}</strong><small>{doc.kind} <ArrowRight size={18} /></small></div>
          <h3>{doc.title}</h3><p>{doc.copy}</p><span className={s.readDocument}>Open document <ArrowRight size={16} /></span>
        </a>
      </LandingReveal>)}
    </div>
    <LandingReveal className={s.questions}>
      <div><h3>Questions worth asking.</h3><p>Start with the limits, then explore what is available in the preview.</p></div>
      <div data-reveal-parts>
        <details><summary>Does the story make a real transaction?</summary><p>No. The story changes local illustration state only. It does not connect a wallet, request a signature or submit to a network.</p></details>
        <details><summary>Can more approvals override a policy failure?</summary><p>No. Authorization and policy checks are separate requirements. The out-of-policy example stays blocked even if more people would like to approve it.</p></details>
        <details><summary>What is ready today?</summary><p>ClearSig is an early devnet/testnet preview. Recovery is pre-alpha and external agent execution is gated. The current Ika path uses a single mock signer, not production distributed MPC. Read the security model before experimenting.</p><Link href="/security">Read the current limitations <ArrowRight size={14} /></Link></details>
      </div>
    </LandingReveal>
    <LandingReveal className={s.reading}><h3>Read the source. Know the limits.</h3><a href={`${repo}/blob/main/docs/product-overview.md`}>Product overview <ArrowRight size={16} /></a><a href={`${repo}/blob/main/README.md`}>Quickstart & devnet demo <ArrowRight size={16} /></a><a href={`${repo}/blob/main/SECURITY.md`}>Threat model <ArrowRight size={16} /></a></LandingReveal>
  </section>;
}

export function LandingFooter() {
  return <LandingReveal as="footer" className={s.footer}>
    <div className={s.footerLead}><Link href="/">ClearSig</Link><p>Sign intents. Not hex.</p><span>Early preview · Test networks only</span></div>
    <nav aria-label="Footer navigation" data-reveal-parts>
      <section><h2>Products</h2><Link href="/personal">Personal</Link><Link href="/pro">Teams</Link><Link href="/secure">Recovery · pre-alpha</Link><Link href="/agent">Agents · gated</Link></section>
      <section><h2>Learn</h2><a href="#story-request">Approval story</a><Link href="/security">Security</Link><Link href="/privacy">Privacy</Link><Link href="/changelog">Changelog</Link></section>
      <section><h2>Build & connect</h2><a href={repo}>GitHub repository</a><a href={`${repo}/blob/main/README.md`}>Developer quickstart</a><a href={`${repo}/blob/main/SECURITY.md`}>Security policy</a><a href="mailto:info@clearsig.xyz">Contact ClearSig</a></section>
    </nav>
    <div className={s.footerEnd}><span>© 2026 ClearSig</span><a href="#overview">Back to the beginning ↑</a></div>
  </LandingReveal>;
}
