"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowDown, ArrowRight, Check, ShieldCheck, Users, X } from "lucide-react";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { SigiStoryTip } from "./SigiGuide";
import s from "./ApprovalStory.module.css";

const chapters = [
  { id: "story-request", short: "Request", title: "Start with the intent.", copy: "Five SOL. One destination. A request everyone can read before anyone approves.", detail: "The amount, recipient and network stay attached to the same request throughout this demonstration." },
  { id: "story-rules", short: "Rules", title: "Put the boundary in view.", copy: "A 10 SOL transfer limit. A known destination. Check the request against the rules before collecting approvals.", detail: "Try the 12 SOL example. An approval cannot make an out-of-policy request safe." },
  { id: "story-people", short: "Owners", title: "Let the right people decide.", copy: "Three owners. Two approvals required. One decision is already recorded in this local example.", detail: "Add a second demo approval to see the threshold change. No wallet opens, no signature is requested and no funds move." },
] as const;

export function ApprovalStory() {
  const root = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [enhanced, setEnhanced] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [approved, setApproved] = useState(false);
  const reduced = useReducedMotion();
  const [ready, setReady] = useState(false);
  const [storyActive, setStoryActive] = useState(false);
  const restoredHash = useRef(false);

  useEffect(() => { setReady(true); }, []);
  useEffect(() => {
    if (!ready || restoredHash.current) return;
    const expected = matchMedia("(min-width: 1000px) and (min-height: 720px)").matches && !reduced;
    if (enhanced !== expected) return;
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (cancelled) return;
      restoredHash.current = true;
      const id = location.hash.slice(1);
      if (chapters.some(chapter => chapter.id === id))
        document.getElementById(id)?.scrollIntoView({ behavior: "instant", block: "start" });
    });
    return () => { cancelled = true; };
  }, [ready, enhanced, reduced]);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const media = matchMedia("(min-width: 1000px) and (min-height: 720px)");
    const configure = () => setEnhanced(media.matches && !reduced);
    configure();
    media.addEventListener("change", configure);
    let frame = 0;
    const update = () => {
      frame = 0;
      const bounds = element.getBoundingClientRect();
      setStoryActive(bounds.top <= 112 && bounds.bottom >= window.innerHeight - 16);
      const points = chapters.map(({ id }) => document.getElementById(id)?.getBoundingClientRect().top ?? 0);
      const travel = Math.max(1, points[2] - points[0]);
      const position = Math.min(1, Math.max(0, (112 - points[0]) / travel));
      element.style.setProperty("--story-progress", String(position));
      element.style.setProperty("--rules-progress", String(Math.min(1, position * 2)));
      element.style.setProperty("--owners-progress", String(Math.max(0, position * 2 - 1)));
      setProgress(Math.round(position * 100));
      setStep(points[2] <= 160 ? 2 : points[1] <= 160 ? 1 : 0);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(element);
    schedule();
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      media.removeEventListener("change", configure);
      observer?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [reduced]);

  const changePolicy = () => { setBlocked(!blocked); setApproved(false); };
  return (
    <section ref={root} id="approval" className={s.story} data-enhanced={enhanced} data-ready={ready} aria-label="An approval, step by step">
      <LandingReveal className={s.intro} id="how-it-works">
        <p className={s.eyebrow}>ONE REQUEST / THREE CHECKS</p>
        <h2>Follow the decision.<br /><span>Keep the whole picture.</span></h2>
        <p>A local, interactive explanation. Solana devnet example. No signing or transaction.</p>
        <a href="#story-request">Begin the story <ArrowDown size={16} aria-hidden="true" /></a>
      </LandingReveal>
      <noscript><p>The full story is below. Interactive examples need JavaScript; no wallet or transaction is involved.</p></noscript>
      <p className="sr-only" role="status">{blocked ? "Policy failed. Demo approvals are unavailable." : approved ? "Two demo approvals recorded. No transaction executed." : "Within policy. One demo approval recorded; one more required."}</p>
      <div className={s.timeline}>
        <div className={s.chapters}>
          {chapters.map((chapter, index) => (
            <LandingReveal as="section" id={chapter.id} tabIndex={-1} className={s.chapter} key={chapter.id} aria-labelledby={`${chapter.id}-title`}>
              <p className={s.eyebrow}>0{index + 1} / {chapter.short}</p>
              <h3 id={`${chapter.id}-title`}>{chapter.title}</h3>
              <p>{chapter.copy}</p>
              <SigiStoryTip step={index}><p className={s.detail}>{chapter.detail}</p></SigiStoryTip>
              {index === 1 && <button className={s.textAction} disabled={!ready} onClick={changePolicy}>{blocked ? "Restore the 5 SOL request" : "Try a request over the limit"} <ArrowRight size={16} aria-hidden="true" /></button>}
              {index === 2 && <button className={s.action} disabled={!ready || blocked} onClick={() => setApproved(!approved)}>{blocked ? "Approval unavailable: policy failed" : approved ? "Reset demo approval" : "Add a demo approval"}<ArrowRight size={16} aria-hidden="true" /></button>}
              <div className={s.flowScene}><ApprovalWorkspace step={index} blocked={blocked} approved={approved} /></div>
            </LandingReveal>
          ))}
        </div>
        <LandingReveal enabled={enhanced} className={s.stage} data-story-stage aria-hidden={!enhanced}>
          <div className={s.stageLabel}><span>OPERATIONS / LOCAL DEMONSTRATION</span><span>0{step + 1} — {chapters[step].short}</span></div>
          <ApprovalWorkspace step={step} blocked={blocked} approved={approved} />
          <p className={s.stageNote}>Same request. Visible rules. Explicit owner decisions.</p>
        </LandingReveal>
      </div>
      <nav className={s.hud} hidden={ready && !storyActive} aria-label="Approval story navigation" style={{ "--progress": `${progress}%` } as CSSProperties}>
        <span className={s.hudLabel}>THE APPROVAL</span>
        <div>{chapters.map((chapter, index) => <a key={chapter.id} href={`#${chapter.id}`} aria-current={step === index ? "step" : undefined}><span>0{index + 1}</span>{chapter.short}</a>)}</div>
        <a className={s.skip} href="#products">Skip story <ArrowRight size={14} aria-hidden="true" /></a>
        <span className={s.progressLabel} aria-label={`Story progress ${progress} percent`}>{progress}%</span>
      </nav>
    </section>
  );
}

function ApprovalWorkspace({ step, blocked, approved }: { step: number; blocked: boolean; approved: boolean }) {
  return <div className={s.workspace} data-step={step} data-blocked={blocked}>
    <div className={s.sceneMark} aria-hidden="true">C</div>
    <div className={s.receipt}>
      <div className={s.receiptTop}><span>REQUEST / 001</span><span>Solana devnet</span></div>
      <p className={s.eyebrow}>TRANSFER</p>
      <p className={s.amount}>{blocked ? "12" : "5"}<span>SOL</span></p>
      <div className={s.destination}><ArrowRight size={20} aria-hidden="true" /><div><span>TO</span><strong>Operations vault</strong><small>Saved destination · illustrative</small></div></div>
      <div className={s.receiptFoot}><span>One immutable request</span><span>Test funds only</span></div>
    </div>
    <div className={s.rules}>
      <div className={s.panelTitle}><ShieldCheck size={18} aria-hidden="true" /><span>POLICY CHECK</span><span>02</span></div>
      <p className={s.result}>{blocked ? <X size={17} aria-hidden="true" /> : <Check size={17} aria-hidden="true" />}{blocked ? "Outside the limit" : "Within the limit"}</p>
      <div className={s.limit}><span>Transfer limit</span><strong>{blocked ? "12" : "5"} / 10 SOL</strong></div>
      <div className={s.meter} role="img" aria-label={blocked ? "12 SOL exceeds the 10 SOL limit" : "5 SOL uses half the 10 SOL limit"}><span style={{ width: blocked ? "100%" : "50%" }} /></div>
      <p>{blocked ? "Stop here. More approvals cannot override this boundary." : "Destination allowed in this example."}</p>
    </div>
    <div className={s.owners} data-story-panel="owners">
      <div className={s.panelTitle}><Users size={18} aria-hidden="true" /><span>OWNER DECISIONS</span><span>03</span></div>
      <div className={s.ownerRow}>{["S", "M", "A"].map((owner, i) => <span key={owner} data-approved={!blocked && (i === 0 || (i === 1 && approved))}>{owner}{!blocked && (i === 0 || (i === 1 && approved)) && <Check size={12} aria-label="Demo approved" />}</span>)}<div><strong>{blocked ? "Blocked by policy" : `${approved ? 2 : 1} of 2 approvals`}</strong><small>{blocked ? "Resolve the request first" : approved ? "Threshold met in this demo" : "3 owners · one more needed"}</small></div></div>
      <p>No signature requested. This demonstration cannot execute.</p>
    </div>
  </div>;
}
