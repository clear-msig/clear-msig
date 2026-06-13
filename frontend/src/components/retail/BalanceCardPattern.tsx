"use client";

import { BrandMark } from "@/components/retail/BrandMark";

const BALANCE_WATERMARK_GRID: {
  top: string;
  left: string;
  size: number;
  rotate: number;
}[] = [
  { top: "-10px", left: "12%", size: 42, rotate: -12 },
  { top: "15%", left: "66%", size: 32, rotate: 18 },
  { top: "38%", left: "7%", size: 36, rotate: 24 },
  { top: "52%", left: "80%", size: 50, rotate: -8 },
  { top: "70%", left: "34%", size: 42, rotate: 14 },
  { top: "84%", left: "58%", size: 30, rotate: -22 },
  { top: "7%", left: "88%", size: 28, rotate: 6 },
];

export function BalanceCardPattern() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden text-accent"
    >
      <div
        className="absolute inset-0 opacity-100"
        style={{
          background:
            "radial-gradient(circle at 100% 0%, rgba(204, 255, 0, 0.1) 0%, rgba(204, 255, 0, 0) 56%)",
        }}
      />
      {BALANCE_WATERMARK_GRID.map((mark) => (
        <div
          key={`${mark.top}-${mark.left}`}
          className="absolute opacity-[0.045]"
          style={{
            top: mark.top,
            left: mark.left,
            transform: `rotate(${mark.rotate}deg)`,
          }}
        >
          <BrandMark size={mark.size} />
        </div>
      ))}
    </div>
  );
}
