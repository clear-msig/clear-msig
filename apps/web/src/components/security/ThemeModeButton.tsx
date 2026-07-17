"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Monitor, Moon, Sun } from "lucide-react";
import {
  getStoredTheme,
  setStoredTheme,
  type ThemeMode,
} from "@/lib/security/theme";

const ORDER: ThemeMode[] = ["system", "light", "dark"];

export function ThemeModeButton({ className }: { className?: string }) {
  const [mode, setMode] = useState<ThemeMode>("system");

  useEffect(() => {
    setMode(getStoredTheme());
  }, []);

  const nextMode = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length] ?? "system";
  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : Monitor;
  const label =
    mode === "light"
      ? "Theme: Light"
      : mode === "dark"
        ? "Theme: Dark"
        : "Theme: System";

  return (
    <button
      type="button"
      aria-label={`${label}. Switch to ${nextMode}.`}
      title={`${label}. Click for ${nextMode}.`}
      onClick={() => {
        setMode(nextMode);
        setStoredTheme(nextMode);
      }}
      className={clsx(
        "inline-flex h-9 w-9 items-center justify-center rounded-soft border border-border-soft bg-glass-soft text-text-soft backdrop-blur-md",
        "transition-[border-color,background-color,color,transform] duration-base ease-out-soft hover:border-border-strong hover:bg-glass-mid hover:text-text-strong active:scale-95",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        className,
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
