"use client";

import { useEffect, useRef, useId } from "react";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";
import s from "../routes/LandingPage.module.css";

// An original geometric C with continuous curved bands and authored lighting. No canvas, WebGL,
// remote assets, continuous animation, or loading gate.
function project(u: number, v: number) {
  const radius = 164 + 46 * Math.cos(v);
  const x = radius * Math.cos(u);
  const y = radius * Math.sin(u);
  const z = 46 * Math.sin(v);
  const a = -0.3;
  const b = 0.45;
  const px = x * Math.cos(a) + z * Math.sin(a);
  const pz = -x * Math.sin(a) + z * Math.cos(a);
  const py = y * Math.cos(b) - pz * Math.sin(b);
  const depth = y * Math.sin(b) + pz * Math.cos(b);
  const scale = 800 / (800 - depth);
  return { x: 600 + px * scale, y: 275 + py * scale, depth };
}
const arcStart = Math.PI / 4;
const arcLength = Math.PI * 1.5;
const arc = (v: number, reverse = false) =>
  Array.from({ length: 65 }, (_, i) => {
    const point = project(
      arcStart + ((reverse ? 64 - i : i) / 64) * arcLength,
      v,
    );
    return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
  }).join(" L ");
const bands = Array.from({ length: 80 }, (_, i) => {
  const v = (i / 80) * Math.PI * 2;
  const next = ((i + 1) / 80) * Math.PI * 2;
  const light = 0.34 + 0.66 * Math.max(0, Math.sin(v + 0.1));
  return {
    path: `M ${arc(v)} L ${arc(next, true)} Z`,
    depth: project(Math.PI, v).depth,
    stops: [26, 95, 235, 24, 58, 150, 32].map((value) => {
      const channel = Math.round(value * light);
      return `rgb(${channel}, ${channel}, ${channel + 3})`;
    }),
  };
}).sort((a, b) => a.depth - b.depth);
const caps = [arcStart, arcStart + arcLength].map((u) =>
  Array.from({ length: 65 }, (_, i) => {
    const point = project(u, (i / 64) * Math.PI * 2);
    return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
  }).join(" "),
);

export function SignatureStage() {
  const figure = useRef<HTMLElement>(null);
  const materialId = useId().replaceAll(":", "");
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    const target = figure.current;
    if (!target) return;
    const hero = target.closest("section");
    hero?.style.setProperty("--hero-progress", "0");
    if (reducedMotion) {
      target.style.setProperty("--stage-progress", "0");
      delete target.dataset.watermark;
      const section = target.closest("section");
      if (!section || typeof IntersectionObserver === "undefined") return;
      // No interpolated movement: the hero stays static, then a stationary,
      // low-contrast background is used after the hero has left the viewport.
      const observer = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) delete target.dataset.watermark;
        else target.dataset.watermark = "static";
      });
      observer.observe(section);
      return () => {
        observer.disconnect();
        delete target.dataset.watermark;
        hero?.style.removeProperty("--hero-progress");
      };
    }
    let frame = 0;
    let lastProgress = "";
    let geometry: { top: number; left: number; width: number; height: number;
      sectionTop: number; sectionHeight: number } | undefined;
    const measure = () => {
      const section = target.closest("section");
      if (!section) return;
      const box = target.getBoundingClientRect();
      const parent = section.getBoundingClientRect();
      const artScale = Number(getComputedStyle(target).getPropertyValue("--art-scale")) || 1;
      geometry = { top: box.top + window.scrollY, left: box.left - box.width * (artScale - 1) / 2,
        width: box.width * artScale, height: box.height,
        sectionTop: parent.top + window.scrollY, sectionHeight: parent.height };
      lastProgress = "";
      schedule();
    };
    const update = () => {
      frame = 0;
      if (!geometry) return;
      const { top, left, width, height, sectionTop, sectionHeight } = geometry;
      const raw = Math.min(1, Math.max(0,
        (window.scrollY - sectionTop) / (sectionHeight * 0.7)));
      const progress = raw * raw * (3 - 2 * raw);
      const value = progress.toFixed(3);
      if (value === lastProgress) return;
      lastProgress = value;
      const backdropWidth = Math.max(width, Math.min(1100, window.innerWidth * 1.7));
      const backdropHeight = Math.min(620, window.innerHeight * 0.7);
      const mix = (from: number, to: number) => from + (to - from) * progress;
      target.style.setProperty("--stage-progress", value);
      hero?.style.setProperty("--hero-progress", value);
      target.style.setProperty("--stage-opacity", String(Math.max(0.07, (1 - progress) ** 4)));
      target.style.setProperty("--stage-top", `${mix(top - window.scrollY, (window.innerHeight - backdropHeight) / 2)}px`);
      target.style.setProperty("--stage-left", `${mix(left, (window.innerWidth - backdropWidth) / 2)}px`);
      target.style.setProperty("--stage-width", `${mix(width, backdropWidth)}px`);
      target.style.setProperty("--stage-height", `${mix(height, backdropHeight)}px`);
      target.dataset.watermark = "true";
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(target);
    if (hero) observer?.observe(hero);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", measure, { passive: true });
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", measure);
      observer?.disconnect();
      if (frame) cancelAnimationFrame(frame);
      delete target.dataset.watermark;
      hero?.style.removeProperty("--hero-progress");
    };
  }, [reducedMotion]);
  return (
    <figure ref={figure} className={s.signatureStage}>
      <svg
        viewBox="0 0 1200 560"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <g className={s.orbitField} stroke="#333336" strokeWidth="0.8">
          <ellipse
            cx="600"
            cy="285"
            rx="390"
            ry="114"
            transform="rotate(-16 600 285)"
          />
          <ellipse
            cx="600"
            cy="285"
            rx="320"
            ry="206"
            transform="rotate(28 600 285)"
            strokeDasharray="2 9"
          />
          <path d="M86 285h1028M600 25v510" strokeDasharray="2 12" />
        </g>
        <defs>
          <filter
            id={`${materialId}-finish`}
            x="-2%"
            y="-2%"
            width="104%"
            height="104%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur stdDeviation="1" />
          </filter>
          {bands.map((band, i) => (
            <linearGradient
              key={i}
              id={`${materialId}-metal-${i}`}
              x1="365"
              y1="75"
              x2="800"
              y2="470"
              gradientUnits="userSpaceOnUse"
            >
              {[0, 0.18, 0.3, 0.5, 0.7, 0.9, 1].map((offset, j) => (
                <stop key={offset} offset={offset} stopColor={band.stops[j]} />
              ))}
            </linearGradient>
          ))}
          <linearGradient
            id={`${materialId}-cap`}
            x1="645"
            y1="90"
            x2="760"
            y2="450"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#65656b" />
            <stop offset="0.3" stopColor="#19191d" />
            <stop offset="0.8" stopColor="#2d2d32" />
            <stop offset="1" stopColor="#77777c" />
          </linearGradient>
        </defs>
        <g className={s.signatureCore}>
          <g filter={`url(#${materialId}-finish)`}>
            {bands.map((band, i) => (
              <path
                key={i}
                d={band.path}
                fill={`url(#${materialId}-metal-${i})`}
                stroke={`url(#${materialId}-metal-${i})`}
                strokeWidth="0.45"
              />
            ))}
          </g>
          {caps.map((points, i) => (
            <polygon
              key={i}
              points={points}
              fill={`url(#${materialId}-cap)`}
              stroke="#88888e"
              strokeOpacity="0.25"
              strokeWidth="0.75"
            />
          ))}
          <path
            d={`M ${arc(1.18)}`}
            stroke="#ccff00"
            strokeOpacity="0.72"
            strokeWidth="1.5"
          />
        </g>
        <g fill="#ccff00">
          <path d="m222 366 4 4-4 4-4-4ZM943 180l4 4-4 4-4-4ZM763 447l4 4-4 4-4-4Z" />
        </g>
      </svg>
      <figcaption>
        Illustrative preview. No transaction or signature.
      </figcaption>
    </figure>
  );
}
