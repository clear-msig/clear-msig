import type { ProSchedule } from "@/lib/pro/treasury";
const key = (wallet: string, endpoint: string) =>
  `clear.recurring-journal.v1:${encodeURIComponent(endpoint)}:${encodeURIComponent(wallet)}`;
export function readRecurringJournal(
  wallet: string,
  endpoint: string,
): ProSchedule[] {
  const value = window.localStorage.getItem(key(wallet, endpoint));
  if (!value) return [];
  const rows: unknown = JSON.parse(value);
  if (
    !Array.isArray(rows) ||
    rows.some((row) => !row || typeof row.id !== "string")
  )
    throw new Error(
      "Recurring recovery data could not be read. Review existing proposals before submitting again.",
    );
  return rows;
}
export function writeRecurringJournal(
  wallet: string,
  endpoint: string,
  row: ProSchedule,
) {
  const rows = readRecurringJournal(wallet, endpoint);
  const next = [row, ...rows.filter((saved) => saved.id !== row.id)];
  const encoded = JSON.stringify(next);
  window.localStorage.setItem(key(wallet, endpoint), encoded);
  if (window.localStorage.getItem(key(wallet, endpoint)) !== encoded)
    throw new Error(
      "Recurring recovery details could not be saved. No submission is allowed.",
    );
  return next;
}
export function removeRecurringJournal(
  wallet: string,
  endpoint: string,
  id: string,
) {
  const rows = readRecurringJournal(wallet, endpoint);
  const next = rows.filter((row) => row.id !== id);
  const encoded = JSON.stringify(next);
  window.localStorage.setItem(key(wallet, endpoint), encoded);
  if (window.localStorage.getItem(key(wallet, endpoint)) !== encoded)
    throw new Error("Could not update recurring recovery data.");
  return next;
}
