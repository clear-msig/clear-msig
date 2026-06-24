import {
  isProductSurfaceId,
  type ProductSurfaceId,
} from "@/lib/productSurfaces";

const GLOBAL_KEY = "clear-msig:selected-product:v1";
const ACCOUNT_KEY_PREFIX = "clear-msig:selected-product:v1:";
const PENDING_KEY = "clear-msig:pending-product:v1";

export function productSurfaceFromPath(
  path: string | null | undefined,
): ProductSurfaceId | null {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return null;
  try {
    const url = new URL(path, "https://clearsig.local");
    const surface = url.searchParams.get("surface");
    return isProductSurfaceId(surface) ? surface : null;
  } catch {
    return null;
  }
}

export function readSelectedProductSurface(
  address?: string | null,
): ProductSurfaceId | null {
  if (typeof window === "undefined") return null;
  const account = normalizeAddress(address);
  const fromAccount = account
    ? readSurface(`${ACCOUNT_KEY_PREFIX}${account}`)
    : null;
  return fromAccount ?? readSurface(GLOBAL_KEY);
}

export function saveSelectedProductSurface(
  surface: ProductSurfaceId,
  address?: string | null,
): void {
  if (typeof window === "undefined") return;
  writeSurface(GLOBAL_KEY, surface);
  const account = normalizeAddress(address);
  if (account) writeSurface(`${ACCOUNT_KEY_PREFIX}${account}`, surface);
}

export function readPendingProductSurface(): ProductSurfaceId | null {
  if (typeof window === "undefined") return null;
  return readSurface(PENDING_KEY);
}

export function savePendingProductSurface(surface: ProductSurfaceId): void {
  if (typeof window === "undefined") return;
  writeSurface(PENDING_KEY, surface);
}

export function clearPendingProductSurface(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PENDING_KEY);
  } catch {
    // Non-critical preference; login still works without storage.
  }
}

export function rememberProductSurfaceChoice(surface: ProductSurfaceId): void {
  saveSelectedProductSurface(surface);
  savePendingProductSurface(surface);
}

function readSurface(key: string): ProductSurfaceId | null {
  try {
    const value = window.localStorage.getItem(key);
    return isProductSurfaceId(value) ? value : null;
  } catch {
    return null;
  }
}

function writeSurface(key: string, surface: ProductSurfaceId): void {
  try {
    window.localStorage.setItem(key, surface);
  } catch {
    // Non-critical preference; login still works without storage.
  }
}

function normalizeAddress(address?: string | null): string | null {
  const trimmed = address?.trim();
  return trimmed ? trimmed : null;
}
