"use client";

import { useEffect, useRef } from "react";
import { getSectionLabel } from "@/lib/retail/sectionLabel";

export function RouteAccessibility({ pathname }: { pathname: string }) {
  const previousPathname = useRef(pathname);
  const announcementRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;

    const frame = window.requestAnimationFrame(() => {
      document.getElementById("main-content")?.focus({ preventScroll: true });
      if (announcementRef.current) {
        const label = getSectionLabel(pathname) || "Page";
        announcementRef.current.textContent = `${label} loaded`;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);

  return (
    <p
      ref={announcementRef}
      className="sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    />
  );
}
