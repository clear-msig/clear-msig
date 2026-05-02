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
//
// Input contract:
//   - Date            → date.getTime() (ms)
//   - bigint          → unix seconds (Solana convention)
//   - number          → unix seconds, OR unix ms — autodetected
//                       by magnitude. Anything ≥ 10^12 is assumed
//                       to be ms (10^12 unix seconds is year 33658,
//                       10^12 ms is 2001 — easy to disambiguate).
//
// The autodetect exists because three call sites historically
// pre-multiplied a bigint-second to ms before calling, then the
// function multiplied again, putting timestamps a thousand years
// in the future. The bug printed "just now" forever. The fix at
// the call sites is a separate change; this autodetect is the
// belt-and-braces so a future contributor can't reintroduce it.

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
const WEEK = 7 * DAY;
const MONTH = 2_629_800; // 30.4375 days, average Gregorian month
const YEAR = 31_557_600; // 365.25 days

/// Threshold above which a number-input is treated as ms instead of
/// unix seconds. ~Sat Sep 09 2001 in seconds; same number is year
/// 33658 in seconds, so any real timestamp falls cleanly on one side.
const MS_THRESHOLD = 1_000_000_000_000;

export function relativeTime(date: Date | number | bigint): string {
  let target: number;
  if (date instanceof Date) {
    target = date.getTime();
  } else if (typeof date === "bigint") {
    target = Number(date) * 1000;
  } else {
    target = date >= MS_THRESHOLD ? date : date * 1000;
  }

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
