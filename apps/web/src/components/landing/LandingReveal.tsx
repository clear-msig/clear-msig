"use client";

import { useEffect, useRef, useState, type CSSProperties, type HTMLAttributes } from "react";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";

// One passive listener/frame for every landing block, including scroll jumps
// that skip both IntersectionObserver boundaries between rendered frames.
const scrollChecks = new Set<() => void>();
let scrollFrame = 0;
function scheduleChecks() {
  if (!scrollFrame) scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    scrollChecks.forEach(check => check());
  });
}
function subscribeScroll(check: () => void) {
  if (!scrollChecks.size) window.addEventListener("scroll", scheduleChecks, { passive: true });
  scrollChecks.add(check);
  return () => {
    scrollChecks.delete(check);
    if (!scrollChecks.size) {
      window.removeEventListener("scroll", scheduleChecks);
      cancelAnimationFrame(scrollFrame);
      scrollFrame = 0;
    }
  };
}

type RevealProps = HTMLAttributes<HTMLDivElement> & {
  as?: "div" | "section" | "article" | "footer";
  enabled?: boolean;
  order?: number;
};

/** Keep layout and SSR readable. Spatial hysteresis makes entry repeatable
 * without blanking the current screen on a small upward scroll. */
export function LandingReveal({ as: Tag = "div", enabled = true, order = 0, children, className = "", style, onFocusCapture, ...props }: RevealProps) {
  const element = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"visible" | "pending" | "instant">("visible");
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    const target = element.current;
    if (!target || !enabled || reduceMotion || typeof IntersectionObserver === "undefined") {
      setState("instant");
      return;
    }
    let frame = 0;
    let arrivingAtAnchor = false;
    const paused = () => !!target.closest("[data-landing-motion-paused]");
    const update = () => {
      frame = 0;
      if (paused()) { setState("instant"); return; }
      if (target.contains(document.activeElement)) {
        setState(value => value === "pending" || document.activeElement?.matches(":focus-visible") ? "instant" : value);
        return;
      }
      const top = target.getBoundingClientRect().top;
      if (arrivingAtAnchor) {
        if (top > window.innerHeight * .78) return;
        arrivingAtAnchor = false;
      }
      if (top >= window.innerHeight * .96) setState("pending");
      else if (top <= window.innerHeight * .78) setState((value) => value === "pending" ? "visible" : value);
    };
    const destination = () => {
      let anchor: HTMLElement | null = null;
      try { anchor = document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch { /* malformed external hash */ }
      const box = target.getBoundingClientRect();
      const anchored = anchor && (target.contains(anchor) || (anchor.contains(target) && box.top - anchor.getBoundingClientRect().top < window.innerHeight - 112));
      if (anchored) arrivingAtAnchor = true;
      if (paused() || anchored || (box.top < window.innerHeight && box.bottom > 0)) setState("instant");
      else update();
    };
    // Initial in-view/restored content is never concealed. Later entries use
    // the 78% boundary; retreat to 96% resets, with an 18% stability band.
    if (target.getBoundingClientRect().top < window.innerHeight) setState("instant");
    else setState("pending");
    destination();
    // Pixel margins follow viewport height (IO percentage margins use width).
    let observers: IntersectionObserver[] = [];
    const observe = () => {
      observers.forEach(observer => observer.disconnect());
      observers = [.22, .04].map(inset => {
        const observer = new IntersectionObserver(update, { threshold: 0, rootMargin: `0px 0px -${window.innerHeight * inset}px 0px` });
        observer.observe(target);
        return observer;
      });
      update();
    };
    const focus = () => setState(value => value === "pending" || document.activeElement?.matches(":focus-visible") ? "instant" : value);
    const blur = () => { if (frame) cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    observe();
    const unsubscribeScroll = subscribeScroll(update);
    target.addEventListener("focusin", focus);
    target.addEventListener("focusout", blur);
    window.addEventListener("hashchange", destination);
    window.addEventListener("pageshow", destination);
    window.addEventListener("resize", observe);
    window.addEventListener("clearsig-motion-change", update);
    return () => {
      unsubscribeScroll();
      observers.forEach(observer => observer.disconnect());
      if (frame) cancelAnimationFrame(frame);
      target.removeEventListener("focusin", focus);
      target.removeEventListener("focusout", blur);
      window.removeEventListener("hashchange", destination);
      window.removeEventListener("pageshow", destination);
      window.removeEventListener("resize", observe);
      window.removeEventListener("clearsig-motion-change", update);
    };
  }, [reduceMotion, enabled]);
  return (
    <Tag {...props} ref={element}
      className={`landing-reveal ${className}`.trim()}
      style={{ ...style, "--reveal-order": order } as CSSProperties}
      data-reveal={state}
      onFocusCapture={(event) => {
        const keyboard = (event.target as HTMLElement).matches(":focus-visible");
        setState(value => keyboard || value === "pending" ? "instant" : value);
        onFocusCapture?.(event);
      }}
    >{children}</Tag>
  );
}
