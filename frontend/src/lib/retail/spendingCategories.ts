"use client";

export type SpendingCategoryId =
  | "rent"
  | "savings"
  | "family"
  | "team"
  | "emergency";

export interface SpendingCategory {
  id: SpendingCategoryId;
  label: string;
  enabled: boolean;
}

const STORAGE_PREFIX = "clear.personal.categories.v1:";

export const DEFAULT_SPENDING_CATEGORIES: SpendingCategory[] = [
  { id: "rent", label: "Rent", enabled: true },
  { id: "savings", label: "Savings", enabled: true },
  { id: "family", label: "Family", enabled: true },
  { id: "team", label: "Team", enabled: false },
  { id: "emergency", label: "Emergency", enabled: true },
];

function storageKey(walletName: string): string {
  return `${STORAGE_PREFIX}${walletName}`;
}

export function getSpendingCategories(walletName: string): SpendingCategory[] {
  if (typeof window === "undefined") return DEFAULT_SPENDING_CATEGORIES;
  try {
    const raw = window.localStorage.getItem(storageKey(walletName));
    if (!raw) return DEFAULT_SPENDING_CATEGORIES;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_SPENDING_CATEGORIES;
    const stored = parsed.filter(isSpendingCategory);
    return DEFAULT_SPENDING_CATEGORIES.map((fallback) => {
      const found = stored.find((row) => row.id === fallback.id);
      return found ?? fallback;
    });
  } catch {
    return DEFAULT_SPENDING_CATEGORIES;
  }
}

export function saveSpendingCategories(
  walletName: string,
  categories: SpendingCategory[],
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(walletName), JSON.stringify(categories));
    window.dispatchEvent(new Event("clear:spending-categories-changed"));
  } catch {
    /* local preferences only */
  }
}

function isSpendingCategory(value: unknown): value is SpendingCategory {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    isSpendingCategoryId(row.id) &&
    typeof row.label === "string" &&
    typeof row.enabled === "boolean"
  );
}

function isSpendingCategoryId(value: unknown): value is SpendingCategoryId {
  return (
    value === "rent" ||
    value === "savings" ||
    value === "family" ||
    value === "team" ||
    value === "emergency"
  );
}
