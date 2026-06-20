import type { RecentActivityRow } from "@/lib/hooks/useRecentActivity";

export interface RecentActivityGroup {
  row: RecentActivityRow;
  count: number;
}

export function groupRecentActivityRows(
  rows: RecentActivityRow[],
): RecentActivityGroup[] {
  const groups = new Map<string, RecentActivityGroup>();
  for (const row of rows) {
    const key = [
      row.walletName,
      row.intentTemplate,
      row.statusLabel,
      row.status,
    ].join(":");
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      if (row.proposedAt > existing.row.proposedAt) {
        existing.row = row;
      }
    } else {
      groups.set(key, { row, count: 1 });
    }
  }
  return Array.from(groups.values()).sort((a, b) =>
    a.row.proposedAt === b.row.proposedAt
      ? 0
      : a.row.proposedAt > b.row.proposedAt
        ? -1
        : 1,
  );
}

export function activityGroupTitle(
  count: number,
  label: string,
): string {
  if (count <= 1) return label;
  return `${label} - ${count} times`;
}
