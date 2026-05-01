// Relative-time formatter for activity rows.
//
// Granularity: seconds → minutes → hours → days → weeks → months →
// years. We collapse to the largest unit that's >= 1, so a 9-day-old
// row reads "1w ago" rather than "9d ago" — once you're past the
// week boundary, the day count stops being the useful information.
//
// Months and years use the average-Gregorian convention (30.44 days
// per month, 365.25 per year) so a steady drumbeat of activity
// doesn't flicker between "29d ago" and "1mo ago" on day 30.

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
const WEEK = 7 * DAY;
const MONTH = 2_629_800; // 30.4375 days, average Gregorian month
const YEAR = 31_557_600; // 365.25 days

export function relativeTime(date: Date | number | bigint): string {
  let target: number;
  if (date instanceof Date) target = date.getTime();
  else if (typeof date === "bigint") target = Number(date) * 1000;
  else target = date * 1000;

  if (!Number.isFinite(target) || target <= 0) return "—";

  const sec = Math.floor((Date.now() - target) / 1000);
  if (sec < 0) return "just now";
  if (sec < 5) return "just now";
  if (sec < MINUTE) return `${sec}s ago`;
  if (sec < HOUR) return `${Math.floor(sec / MINUTE)}m ago`;
  if (sec < DAY) return `${Math.floor(sec / HOUR)}h ago`;
  if (sec < WEEK) return `${Math.floor(sec / DAY)}d ago`;
  if (sec < MONTH) return `${Math.floor(sec / WEEK)}w ago`;
  if (sec < YEAR) return `${Math.floor(sec / MONTH)}mo ago`;
  return `${Math.floor(sec / YEAR)}y ago`;
}
