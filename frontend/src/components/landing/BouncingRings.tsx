"use client";

// Canvas-based floating rings. The signature ambient background of
// the landing page. Extracted from the original page.tsx so it can be
// dynamic-imported (SSR-safe) and so the landing composition stays
// readable.
//
// Physics: elastic collisions with walls + ring-to-ring, mobile-aware
// density + speed. About 12 rings on desktop, 6 on mobile. Cheap
// enough to leave at 60fps without dragging paint time.

import { useEffect, useRef } from "react";

interface Ring {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  thickness: number;
}

export function BouncingRings() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId = 0;
    let circles: Ring[] = [];
    // Respect reduced motion: render a single frame with zero velocity.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const init = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const isMobile = window.innerWidth <= 768;
      const count = isMobile ? 6 : 12;
      const speedMultiplier = isMobile ? 0.4 : 1.5;
      circles = [];
      for (let i = 0; i < count; i++) {
        const baseRadius = isMobile ? 30 : 60;
        const radiusVar = isMobile ? 40 : 80;
        const radius = Math.random() * radiusVar + baseRadius;
        circles.push({
          x: Math.random() * (canvas.width - radius * 2) + radius,
          y: Math.random() * (canvas.height - radius * 2) + radius,
          vx: reduced ? 0 : (Math.random() - 0.5) * speedMultiplier,
          vy: reduced ? 0 : (Math.random() - 0.5) * speedMultiplier,
          radius,
          thickness: Math.random() * 3 + 2,
        });
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < circles.length; i++) {
        const c = circles[i];
        c.x += c.vx;
        c.y += c.vy;
        if (c.x - c.radius < 0) { c.x = c.radius; c.vx *= -1; }
        if (c.x + c.radius > canvas.width) { c.x = canvas.width - c.radius; c.vx *= -1; }
        if (c.y - c.radius < 0) { c.y = c.radius; c.vy *= -1; }
        if (c.y + c.radius > canvas.height) { c.y = canvas.height - c.radius; c.vy *= -1; }
        for (let j = i + 1; j < circles.length; j++) {
          const c2 = circles[j];
          const dx = c2.x - c.x;
          const dy = c2.y - c.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < c.radius + c2.radius) {
            const angle = Math.atan2(dy, dx);
            const sin = Math.sin(angle);
            const cos = Math.cos(angle);
            const vx1 = c.vx * cos + c.vy * sin;
            const vy1 = c.vy * cos - c.vx * sin;
            const vx2 = c2.vx * cos + c2.vy * sin;
            const vy2 = c2.vy * cos - c2.vx * sin;
            const tvx1 = vx2;
            const tvx2 = vx1;
            c.vx = tvx1 * cos - vy1 * sin;
            c.vy = vy1 * cos + tvx1 * sin;
            c2.vx = tvx2 * cos - vy2 * sin;
            c2.vy = vy2 * cos + tvx2 * sin;
            const overlap = c.radius + c2.radius - dist;
            const sepX = (overlap * cos) / 2;
            const sepY = (overlap * sin) / 2;
            c.x -= sepX;
            c.y -= sepY;
            c2.x += sepX;
            c2.y += sepY;
          }
        }
      }
      for (const c of circles) {
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.radius, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(20, 241, 149, 0.35)";
        ctx.lineWidth = c.thickness;
        ctx.stroke();
      }
      if (!reduced) animationFrameId = requestAnimationFrame(draw);
    };

    window.addEventListener("resize", init);
    init();
    draw();
    return () => {
      window.removeEventListener("resize", init);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[10] opacity-80"
    />
  );
}
