"use client";

const STORAGE_PREFIX = "clear.personal.receipts.v1:";
const MAX_RECEIPTS = 50;

export interface PersonalReceipt {
  id: string;
  walletName: string;
  title: string;
  body: string;
  createdAt: number;
}

function storageKey(walletName: string): string {
  return `${STORAGE_PREFIX}${walletName}`;
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

export function listPersonalReceipts(walletName: string): PersonalReceipt[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(walletName));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isPersonalReceipt)
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export function recordPersonalReceipt(
  walletName: string,
  input: Pick<PersonalReceipt, "title" | "body">,
): PersonalReceipt | null {
  if (typeof window === "undefined") return null;
  const receipt: PersonalReceipt = {
    id: createId(),
    walletName,
    title: input.title,
    body: input.body,
    createdAt: Date.now(),
  };
  try {
    const next = [receipt, ...listPersonalReceipts(walletName)].slice(
      0,
      MAX_RECEIPTS,
    );
    window.localStorage.setItem(storageKey(walletName), JSON.stringify(next));
    window.dispatchEvent(new Event("clear:personal-receipts-changed"));
    return receipt;
  } catch {
    return null;
  }
}

function isPersonalReceipt(value: unknown): value is PersonalReceipt {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.walletName === "string" &&
    typeof row.title === "string" &&
    typeof row.body === "string" &&
    typeof row.createdAt === "number"
  );
}
