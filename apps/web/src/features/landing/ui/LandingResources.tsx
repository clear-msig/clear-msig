import Link from "next/link";
import { ArrowRight, Fingerprint, ShieldCheck, Users } from "lucide-react";
import s from "./LandingResources.module.css";

const repo = "https://github.com/clear-msig/clear-msig";
export function LandingResources() {
  return <section id="resources" className={s.resources} aria-labelledby="resources-title">
    <div className={s.heading}><p>UNDERSTAND BEFORE YOU START</p><h2 id="resources-title">The details are<br />part of the product.</h2></div>
    <div className={s.explainers}>
      <article><div className={s.diagram} aria-hidden="true"><span>5 SOL</span><ArrowRight /><span>Vault</span><div>AMOUNT · DESTINATION · NETWORK</div></div><h3>A request you can inspect.</h3><p>Read the intended action before the wallet prompt. The exact prepared document remains the thing you sign.</p><a href="#story-request">Walk through an approval <ArrowRight size={16} /></a></article>
      <article><div className={s.diagram} aria-hidden="true"><Fingerprint /><span>Owner</span><span>Owner</span><div>TWO APPROVALS / THREE OWNERS</div></div><h3>Recovery is a separate decision.</h3><p>Explore recovery vaults and threshold decisions. Recovery is pre-alpha; setup and device support have limits.</p><Link href="/secure">Explore recovery <ArrowRight size={16} /></Link></article>
      <article><div className={s.diagram} aria-hidden="true"><Users /><ArrowRight /><ShieldCheck /><div>REQUEST → POLICY → APPROVAL</div></div><h3>Permission is not execution.</h3><p>Agents must stay within signed authority and verified limits. External execution remains gated. A practice result is not a live trade.</p><Link href="/agent">Understand agent boundaries <ArrowRight size={16} /></Link></article>
    </div>
    <div className={s.questions}>
      <div><h3>Questions worth asking.</h3><p>Start with the limits, then explore what is available in the preview.</p></div>
      <div>
        <details><summary>Does the story make a real transaction?</summary><p>No. The story changes local illustration state only. It does not connect a wallet, request a signature or submit to a network.</p></details>
        <details><summary>Can more approvals override a policy failure?</summary><p>No. Authorization and policy checks are separate requirements. The out-of-policy example stays blocked even if more people would like to approve it.</p></details>
        <details><summary>What is ready today?</summary><p>ClearSig is an early devnet/testnet preview. Recovery is pre-alpha and external agent execution is gated. The current Ika path uses a single mock signer, not production distributed MPC. Read the security model before experimenting.</p><Link href="/security">Read the current limitations <ArrowRight size={14} /></Link></details>
      </div>
    </div>
    <div className={s.reading}><h3>Read the source. Know the limits.</h3><a href={`${repo}/blob/main/docs/product-overview.md`}>Product overview <ArrowRight size={16} /></a><a href={`${repo}/blob/main/README.md`}>Quickstart & devnet demo <ArrowRight size={16} /></a><a href={`${repo}/blob/main/SECURITY.md`}>Threat model <ArrowRight size={16} /></a></div>
  </section>;
}

export function LandingFooter() {
  return <footer className={s.footer}>
    <div className={s.footerLead}><Link href="/">ClearSig</Link><p>Sign intents. Not hex.</p><span>Early preview · Test networks only</span></div>
    <nav aria-label="Footer navigation">
      <section><h2>Products</h2><Link href="/personal">Personal</Link><Link href="/pro">Teams</Link><Link href="/secure">Recovery · pre-alpha</Link><Link href="/agent">Agents · gated</Link></section>
      <section><h2>Learn</h2><a href="#story-request">Approval story</a><Link href="/security">Security</Link><Link href="/privacy">Privacy</Link><Link href="/changelog">Changelog</Link></section>
      <section><h2>Build & connect</h2><a href={repo}>GitHub repository</a><a href={`${repo}/blob/main/README.md`}>Developer quickstart</a><a href={`${repo}/blob/main/SECURITY.md`}>Security policy</a><a href="mailto:info@clearsig.xyz">Contact ClearSig</a></section>
    </nav>
    <div className={s.footerEnd}><span>© 2026 ClearSig</span><a href="#overview">Back to the beginning ↑</a></div>
  </footer>;
}
