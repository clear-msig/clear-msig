"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "framer-motion";

/** Progressive enhancement: content is visible in SSR, without JS, and when
 * reduced motion is enabled. Only offscreen landing storytelling is deferred. */
export function LandingReveal({ children }: { children: ReactNode }) {
  const element = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    const target = element.current;
    if (!target || reduceMotion || typeof IntersectionObserver === "undefined") {
      setPending(false);
      return;
    }
    // Never conceal content already in view, including hash-link landings.
    if (target.getBoundingClientRect().top < window.innerHeight - 48) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setPending(false);
        observer.disconnect();
      }
    }, { threshold: 0.02, rootMargin: "0px 0px -48px 0px" });
    setPending(true);
    observer.observe(target);
    return () => observer.disconnect();
  }, [reduceMotion]);
  return <div ref={element} className="landing-reveal" data-reveal={pending ? "pending" : "visible"} onFocusCapture={() => setPending(false)}>{children}</div>;
}
