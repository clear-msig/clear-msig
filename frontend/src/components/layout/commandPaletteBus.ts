"use client";

export const COMMAND_PALETTE_OPEN_EVENT = "clearsig:command-palette-open";

let pendingOpen = false;

export function requestCommandPaletteOpen(): void {
  pendingOpen = true;
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(COMMAND_PALETTE_OPEN_EVENT));
}

export function consumePendingCommandPaletteOpen(): boolean {
  const shouldOpen = pendingOpen;
  pendingOpen = false;
  return shouldOpen;
}
