"use client";

import { useEffect, useRef, useState } from "react";
import { useScroll, useTransform, motion } from "framer-motion";
import clsx from "clsx";

interface Point {
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseX: number;
  baseY: number;
}

export function ConstellationBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const mouseRef = useRef({ x: -1000, y: -1000 });
  const pointsRef = useRef<Point[]>([]);

  // We parallax slightly based on scroll
  const { scrollY } = useScroll();
  const yOffset = useTransform(scrollY, [0, 2000], [0, 150]);

  // Adjust these for density and look
  const POINT_COUNT = 80;
  const CONNECT_DISTANCE = 150;
  const MOUSE_REPEL_RADIUS = 120;
  const MOUSE_REPEL_FORCE = 0.05;

  useEffect(() => {
    const updateSize = () => {
      if (!containerRef.current || !canvasRef.current) return;
      const { clientWidth, clientHeight } = containerRef.current;
      setDimensions({ width: clientWidth, height: clientHeight });
      
      const dpr = window.devicePixelRatio || 1;
      canvasRef.current.width = clientWidth * dpr;
      canvasRef.current.height = clientHeight * dpr;
      
      const ctx = canvasRef.current.getContext("2d");
      if (ctx) ctx.scale(dpr, dpr);

      // Re-init points
      initPoints(clientWidth, clientHeight);
    };

    const initPoints = (w: number, h: number) => {
      pointsRef.current = Array.from({ length: POINT_COUNT }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        baseX: Math.random() * w,
        baseY: Math.random() * h,
      }));
    };

    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;

    const render = () => {
      // Clear
      ctx.clearRect(0, 0, dimensions.width, dimensions.height);

      const points = pointsRef.current;
      const mouse = mouseRef.current;
      const w = dimensions.width;
      const h = dimensions.height;

      // Update positions
      for (let i = 0; i < points.length; i++) {
        let p = points[i];
        
        // Basic movement
        p.x += p.vx;
        p.y += p.vy;

        // Bounce off edges
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;

        // Mouse interaction (repel)
        const dx = mouse.x - p.x;
        const dy = mouse.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < MOUSE_REPEL_RADIUS) {
          const force = (MOUSE_REPEL_RADIUS - dist) / MOUSE_REPEL_RADIUS;
          p.x -= (dx / dist) * force * MOUSE_REPEL_FORCE * 100;
          p.y -= (dy / dist) * force * MOUSE_REPEL_FORCE * 100;
        }

        // Draw point
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(20, 241, 149, 0.4)"; // brand-green
        ctx.fill();

        // Connect points
        for (let j = i + 1; j < points.length; j++) {
          const p2 = points[j];
          const dlx = p.x - p2.x;
          const dly = p.y - p2.y;
          const dDist = Math.sqrt(dlx * dlx + dly * dly);

          if (dDist < CONNECT_DISTANCE) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            // Opacity based on distance
            const opacity = (1 - dDist / CONNECT_DISTANCE) * 0.15;
            ctx.strokeStyle = `rgba(20, 241, 149, ${opacity})`;
            ctx.stroke();
          }
        }
      }

      animationId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animationId);
  }, [dimensions]);

  return (
    <div ref={containerRef} className="fixed inset-0 z-[-1] overflow-hidden pointer-events-none bg-white">
      {/* Topography Base Map */}
      <div 
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='100%' height='100%' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.005' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='1 0 0 0 0, 0 1 0 0 0, 0 0 1 0 0, 0 0 0 0.5 0' /%3E%3C/filter%3E%3Crect width='100%' height='100%' filter='url(%23noise)'/%3E%3C/svg%3E")`,
          filter: "contrast(150%) brightness(50%)"
        }}
      />
      
      {/* Radial fade so the animation isn't overwhelming on the edges */}
      <div className="absolute inset-0 bg-radial-gradient from-transparent to-white/80" />

      <motion.canvas
        ref={canvasRef}
        style={{ y: yOffset }}
        className="absolute inset-0 w-full h-full"
      />
      
      {/* Subtle Green Ambient Lights */}
      <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-brand-green/5 rounded-full blur-[120px] mix-blend-multiply" />
      <div className="absolute bottom-1/4 right-1/4 w-[600px] h-[600px] bg-brand-green/5 rounded-full blur-[150px] mix-blend-multiply" />
    </div>
  );
}
