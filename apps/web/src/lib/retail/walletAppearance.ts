"use client";

// Per-wallet appearance - shape preset + color.
//
// Stored locally because the chain doesn't carry presentation
// metadata. Two pieces:
//   - `shape`  → the picker preset selected at create time
//                ("just_me" / "couple" / "family" / "roommates" /
//                "team"). Drives the wallet-hub subtitle and the
//                contextual copy on follow-up flows.
//   - `color`  → user override of the deterministic gradient avatar.
//                Picked on the welcome confirm screen; defaults to
//                the deterministic gradient when not set so existing
//                wallets keep their look.
//   - `surface` → the product lane this wallet was created for.
//                 This drives product-specific navigation and landing
//                 so Personal, Pro, Agents, and Secure do not collapse
//                 into the same generic workspace.
//
// Migration path when the chain grows a metadata account: this
// module becomes a cache; reads/writes proxy through a backend
// upsert. Keys + types are designed for that swap.

import type { ProductSurfaceId } from "@/lib/productSurfaces";

const STORAGE_KEY = "clear-msig:wallet-appearance:v1";

/// Curated color palette for the wallet avatar override. 6 options
/// is enough variety for ~6 wallets per user without collisions but
/// not so many that the picker becomes a chore. Each entry maps to
/// a Tailwind gradient `from`/`to` pair so the avatar component can
/// use the value verbatim.
export const COLOR_PALETTE: ReadonlyArray<{
  id: string;
  label: string;
  from: string;
  to: string;
}> = [
  { id: "emerald", label: "Emerald", from: "from-emerald-300", to: "to-teal-400" },
  { id: "sky", label: "Sky", from: "from-sky-300", to: "to-blue-400" },
  { id: "violet", label: "Violet", from: "from-violet-300", to: "to-purple-400" },
  { id: "rose", label: "Rose", from: "from-rose-300", to: "to-orange-300" },
  { id: "amber", label: "Amber", from: "from-amber-300", to: "to-yellow-300" },
  { id: "lime", label: "Lime", from: "from-lime-300", to: "to-green-400" },
];

export type WalletShapeId =
  | "just_me"
  | "couple"
  | "family"
  | "roommates"
  | "team";

export const SHAPE_LABEL: Record<WalletShapeId, string> = {
  just_me: "Just me",
  couple: "Couple",
  family: "Family",
  roommates: "Roommates",
  team: "Team",
};

export interface WalletAppearance {
  walletName: string;
  shape?: WalletShapeId;
  surface?: ProductSurfaceId;
  /// One of `COLOR_PALETTE[i].id`. When unset, callers fall back to
  /// `avatarGradient(walletName)` - the deterministic colour the
  /// wallet has worn since before this picker existed.
  color?: string;
  updatedAt: number;
}

function loadAll(): WalletAppearance[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isAppearance);
  } catch {
    return [];
  }
}

function persist(rows: WalletAppearance[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // Quota / privacy mode - appearance is non-critical, fail soft.
  }
}

export function getWalletAppearance(walletName: string): WalletAppearance | null {
  return (
    loadAll().find((r) => r.walletName === walletName) ?? null
  );
}

export function saveWalletAppearance(
  walletName: string,
  patch: Partial<Pick<WalletAppearance, "shape" | "color" | "surface">>,
): WalletAppearance {
  const all = loadAll();
  const existing = all.find((r) => r.walletName === walletName);
  const next: WalletAppearance = {
    walletName,
    shape: patch.shape ?? existing?.shape,
    surface: patch.surface ?? existing?.surface,
    color: patch.color ?? existing?.color,
    updatedAt: Date.now(),
  };
  const rest = all.filter((r) => r.walletName !== walletName);
  rest.push(next);
  persist(rest);
  return next;
}

/// Returns the gradient pair the caller should use - picked color if
/// the user set one, otherwise the deterministic gradient. Centralizes
/// the precedence so call sites don't repeat it.
export function gradientFor(
  walletName: string,
  fallback: { from: string; to: string },
): { from: string; to: string } {
  const appearance = getWalletAppearance(walletName);
  if (!appearance?.color) return fallback;
  const pick = COLOR_PALETTE.find((p) => p.id === appearance.color);
  return pick ? { from: pick.from, to: pick.to } : fallback;
}

function isAppearance(r: unknown): r is WalletAppearance {
  if (!r || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  return (
    typeof o.walletName === "string" &&
    typeof o.updatedAt === "number" &&
    (o.shape === undefined || typeof o.shape === "string") &&
    (o.surface === undefined || typeof o.surface === "string") &&
    (o.color === undefined || typeof o.color === "string")
  );
}
