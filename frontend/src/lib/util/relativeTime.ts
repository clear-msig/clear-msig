// "5m ago" / "2d ago" formatter. Anything older than a day is rendered
// as "Nd ago" — the dashboard rows it backs are already cluttered, so
// week / month resolution is fine.

export function relativeTime(date: Date | number | bigint): string {
  let target: number;
  if (date instanceof Date) target = date.getTime();
  else if (typeof date === "bigint") target = Number(date) * 1000;
  else target = date * 1000;

  if (!Number.isFinite(target) || target <= 0) return "—";

  const sec = Math.floor((Date.now() - target) / 1000);
  if (sec < 0) return "just now";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}
