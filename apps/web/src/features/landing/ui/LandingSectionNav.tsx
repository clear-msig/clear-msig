"use client";

import { useEffect, useState } from "react";
import s from "../routes/LandingPage.module.css";

const sections = [
  ["overview", "Overview"],
  ["approval", "Approval example"],
  ["how-it-works", "How it works"],
  ["products", "Products"],
] as const;

/** Native anchor navigation remains usable without JavaScript. */
export function LandingSectionNav() {
  const [active, setActive] = useState<string>("overview");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: "-15% 0px -55% 0px" },
    );
    for (const [id] of sections) {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <nav className={s.sectionRail} aria-label="Landing sections">
      {sections.map(([id, label]) => (
        <a
          key={id}
          href={`#${id}`}
          aria-label={label}
          aria-current={active === id ? "location" : undefined}
        >
          <span />
        </a>
      ))}
    </nav>
  );
}
