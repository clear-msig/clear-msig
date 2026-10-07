"use client";

import Image from "next/image";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import s from "./SigiGuide.module.css";

type Mode = "welcome" | "tour" | "quiet" | "dismissed";
const preferenceKey = "clearsig:sigi:preference";
const GuideContext = createContext({ mode: "welcome" as Mode, ready: false, choose: (_mode: Mode) => {} });

export function SigiGuideProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>("welcome");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(preferenceKey);
      if (saved === "quiet" || saved === "dismissed") setMode(saved);
    } catch { /* Optional preference storage must never gate the landing. */ }
    setReady(true);
  }, []);
  const choose = (next: Mode) => {
    setMode(next);
    try {
      if (next === "quiet" || next === "dismissed") sessionStorage.setItem(preferenceKey, next);
      else sessionStorage.removeItem(preferenceKey);
    } catch { /* The guide still works when storage is unavailable. */ }
  };
  return <GuideContext.Provider value={{ mode, ready, choose }}>{children}</GuideContext.Provider>;
}

function CloseMark() {
  return <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>;
}

function Owl({ priority = false }: { priority?: boolean }) {
  return <Image className={s.owl} src="/brand/sigi.png" alt="Sigi, the ClearSig owl" width={217} height={266} unoptimized priority={priority} />;
}

export function SigiWelcome() {
  const { mode, ready, choose } = useContext(GuideContext);
  if (mode === "dismissed") return null;
  const leaveWelcome = (next: Mode) => {
    choose(next);
    document.getElementById("explore-clearsig")?.focus();
  };
  return <aside className={s.welcome} aria-label="Sigi welcome" data-ready={ready}>
    <Owl priority />
    {mode === "welcome" ? <div className={s.bubble}>
      <div className={s.top}><span>MEET SIGI</span><button type="button" disabled={!ready} aria-label="Dismiss Sigi" onClick={() => leaveWelcome("dismissed")}><CloseMark /></button></div>
      <p>Hi, I’m Sigi. Let’s make your next signature make sense.</p>
      <a href="#story-request" onClick={() => choose("tour")}>Show me around <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13 13 3M3 3h10v10" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></a>
      <button className={s.explore} type="button" disabled={!ready} onClick={() => leaveWelcome("quiet")}>Explore myself</button>
    </div> : <button className={s.dismiss} type="button" disabled={!ready} aria-label="Dismiss Sigi" onClick={() => leaveWelcome("dismissed")}><CloseMark /></button>}
  </aside>;
}

export function SigiStoryTip({ step, children }: { step: number; children: ReactNode }) {
  const { mode, choose } = useContext(GuideContext);
  if (mode !== "tour") return children;
  return <aside className={s.tip} aria-label={`Sigi guide, step ${step + 1}`}>
    <div className={s.tipTop}><span>SIGI / 0{step + 1}</span>
      <button type="button" onClick={(event) => {
        const chapter = event.currentTarget.closest("section");
        choose("quiet");
        chapter?.focus({ preventScroll: true });
      }}>End guide</button>
    </div>
    {children}
  </aside>;
}

export function SigiReturn() {
  const { mode, ready, choose } = useContext(GuideContext);
  if (mode === "dismissed") return null;
  return <aside className={s.return} aria-label="A note from Sigi" data-ready={ready}>
    <Owl />
    <div><span>A NOTE FROM SIGI</span><p>Start with the limits. The questions below are a good place to begin.</p></div>
    <button type="button" disabled={!ready} aria-label="Dismiss Sigi" onClick={() => {
      choose("dismissed");
      document.getElementById("resources-title")?.focus({ preventScroll: true });
    }}><CloseMark /></button>
  </aside>;
}
