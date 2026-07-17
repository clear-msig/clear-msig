"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import {
  COMMAND_PALETTE_OPEN_EVENT,
  requestCommandPaletteOpen,
} from "@/components/layout/commandPaletteBus";

const LazyCommandPalette = dynamic(
  () =>
    import("@/components/layout/CommandPalette").then((mod) => mod.CommandPalette),
  {
    ssr: false,
    loading: () => null,
  },
);

export function CommandPaletteLoader() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const mountAndOpen = () => setMounted(true);
    const onKey = (event: KeyboardEvent) => {
      const isMac =
        typeof navigator !== "undefined" &&
        /Mac|iPod|iPhone|iPad/.test(navigator.platform);
      const mod = isMac ? event.metaKey : event.ctrlKey;
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setMounted(true);
        requestCommandPaletteOpen();
      }
    };

    window.addEventListener(COMMAND_PALETTE_OPEN_EVENT, mountAndOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(COMMAND_PALETTE_OPEN_EVENT, mountAndOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return mounted ? <LazyCommandPalette /> : null;
}
