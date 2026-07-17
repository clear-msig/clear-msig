// Unix timestamp → "YYYY-MM-DD HH:MM:SS" formatter.
//
// Byte-for-byte mirror of programs/clear-wallet/src/utils/datetime.rs::format_timestamp.
// The signed message contains `"expires 2030-01-01 00:00:00: ..."` and
// on-chain signature verification hashes the exact same bytes, so this
// has to match Rust's output for every timestamp, including negative
// ones (pre-1970) and edge cases around era boundaries.
//
// We use BigInt throughout because the Howard Hinnant civil-date
// algorithm pushes intermediates past 2^53 for timestamps beyond a few
// million years . unnecessary in practice but cheap insurance against
// precision drift.

/// Format a Unix timestamp (seconds since 1970-01-01 UTC) as
/// `"YYYY-MM-DD HH:MM:SS"`. Bit-exact with the on-chain builder.
export function formatTimestamp(timestamp: number | bigint): string {
  const ts = typeof timestamp === "bigint" ? timestamp : BigInt(timestamp);
  const { year, month, day, hour, minute, second } = timestampToParts(ts);

  // Four-digit year (padded), two-digit everything else.
  // We mirror write_decimal_4 / write_decimal_2 exactly instead of using
  // String.padStart so the output has no hidden locale behaviour.
  const yy = writeDecimal4(year);
  const mm = writeDecimal2(month);
  const dd = writeDecimal2(day);
  const hh = writeDecimal2(hour);
  const mi = writeDecimal2(minute);
  const ss = writeDecimal2(second);
  return `${yy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

/// Convenience: return the UTF-8 bytes of the formatted timestamp. The
/// on-chain builder writes these 19 bytes directly into its message
/// buffer, so callers can splice them in without re-encoding.
export function formatTimestampBytes(timestamp: number | bigint): Uint8Array {
  return new TextEncoder().encode(formatTimestamp(timestamp));
}

// ── internals ─────────────────────────────────────────────────────────

const SECS_PER_DAY = 86_400n;
const ZERO = 0n;
const ONE = 1n;

interface DateParts {
  year: bigint;
  month: bigint;
  day: bigint;
  hour: bigint;
  minute: bigint;
  second: bigint;
}

function timestampToParts(totalSecs: bigint): DateParts {
  // Mirror Rust's i64 arithmetic: truncation toward zero.
  let days = truncDiv(totalSecs, SECS_PER_DAY);
  // Euclidean `day_secs`: always in [0, 86400).
  const daySecs =
    ((totalSecs % SECS_PER_DAY) + SECS_PER_DAY) % SECS_PER_DAY;

  // Rust's floor-down for negative timestamps: if we had a positive
  // remainder after a negative division, we must decrement `days` so
  // that `days * 86400 + day_secs == total_secs`.
  if (totalSecs < ZERO && daySecs > ZERO) {
    days -= ONE;
  }

  const hour = truncDiv(daySecs, 3600n);
  const minute = truncDiv(daySecs % 3600n, 60n);
  const second = daySecs % 60n;

  // Howard Hinnant civil-date algorithm. Epoch shift: 1970-01-01 lies
  // 719468 days after 0000-03-01 (the start of the algorithm's "era 0").
  days += 719_468n;
  const era = truncDiv(days >= ZERO ? days : days - 146_096n, 146_097n);
  const doe = days - era * 146_097n; // day-of-era [0, 146096]
  const yoe = truncDiv(
    doe - truncDiv(doe, 1460n) + truncDiv(doe, 36_524n) - truncDiv(doe, 146_096n),
    365n
  ); // year-of-era [0, 399]
  const y = yoe + era * 400n;
  const doy = doe - (365n * yoe + truncDiv(yoe, 4n) - truncDiv(yoe, 100n)); // day-of-year [0, 365]
  const mp = truncDiv(5n * doy + 2n, 153n); // month prime [0, 11]
  const d = doy - truncDiv(153n * mp + 2n, 5n) + 1n; // day-of-month [1, 31]
  const m = mp < 10n ? mp + 3n : mp - 9n; // month [1, 12]
  const year = m <= 2n ? y + 1n : y;

  return { year, month: m, day: d, hour, minute, second };
}

/// BigInt division truncating toward zero (matches Rust's `/` on signed
/// integers). BigInt's native `/` already truncates toward zero, so this
/// is a semantic marker rather than extra logic.
function truncDiv(a: bigint, b: bigint): bigint {
  return a / b;
}

function writeDecimal4(val: bigint): string {
  const v = val < ZERO ? 0 : Number(val); // Rust's `year as u32` wraps; we clamp.
  const a = (v / 1000) | 0;
  const b = ((v / 100) | 0) % 10;
  const c = ((v / 10) | 0) % 10;
  const d = v % 10;
  return `${a}${b}${c}${d}`;
}

function writeDecimal2(val: bigint): string {
  const v = Number(val);
  const hi = (v / 10) | 0;
  const lo = v % 10;
  return `${hi}${lo}`;
}
