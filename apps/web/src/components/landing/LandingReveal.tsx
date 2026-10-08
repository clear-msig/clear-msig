"use client";

import { useEffect, useRef, useState, type HTMLAttributes } from "react";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";

type RevealProps = HTMLAttributes<HTMLDivElement> & {
  as?: "div" | "section" | "article" | "footer";
  enabled?: boolean;
};

/** SSR stays readable. Only below-viewport content is armed after hydration;
 * each block enters once, without removing content or changing its geometry. */
export function LandingReveal({ as: Tag = "div", enabled = true, children, className = "", onFocusCapture, ...props }: RevealProps) {
  const element = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"visible" | "pending" | "instant">("visible");
  const reduceMotion = useReducedMotion();
  const revealed = useRef(false);
  useEffect(() => {
    const target = element.current;
    if (!target || !enabled || reduceMotion || typeof IntersectionObserver === "undefined") {
      setState("visible");
      return;
    }
    const inView = () => {
      const box = target.getBoundingClientRect();
      return box.top < window.innerHeight && box.bottom > 0;
    };
    const atDestination = () => {
      let anchor: HTMLElement | null = null;
      try { anchor = document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch { /* malformed external hash */ }
      if (!anchor) return false;
      if (target.contains(anchor)) return true;
      // A section hash exposes its first screen, not all of its later cards.
      return anchor.contains(target) &&
        target.getBoundingClientRect().top - anchor.getBoundingClientRect().top < window.innerHeight - 112;
    };
    if (atDestination()) {
      revealed.current = true;
      setState("instant");
      return;
    }
    // Do not hide a restored scroll position, an initial hash destination, or
    // content already passed. Native layout/scroll restoration remains intact.
    if (revealed.current || target.getBoundingClientRect().top < window.innerHeight) {
      revealed.current = true;
      return;
    }
    const reveal = (instant = false) => {
      revealed.current = true;
      setState(instant ? "instant" : "visible");
      stop();
    };
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) reveal();
    }, { threshold: 0, rootMargin: "0px 0px -48px 0px" });
    const revealDestination = () => {
      if (inView() || atDestination()) reveal(true);
    };
    const revealFocused = () => reveal(true);
    const stop = () => {
      observer.disconnect();
      target.removeEventListener("focusin", revealFocused);
      window.removeEventListener("hashchange", revealDestination);
      window.removeEventListener("pageshow", revealDestination);
    };
    setState("pending");
    observer.observe(target);
    target.addEventListener("focusin", revealFocused);
    window.addEventListener("hashchange", revealDestination);
    window.addEventListener("pageshow", revealDestination);
    return stop;
  }, [reduceMotion, enabled]);
  return (
    <Tag {...props} ref={element}
      className={`landing-reveal ${className}`.trim()}
      data-reveal={state}
      onFocusCapture={(event) => { revealed.current = true; setState("instant"); onFocusCapture?.(event); }}
    >
      {children}
    </Tag>
  );
}
