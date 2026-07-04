use crate::ApiError;

/// Convert a Unix expiry timestamp into the `YYYY-MM-DD HH:MM:SS` form the
/// CLI expects on `--expiry`. This mirrors the CLI's `message::parse_expiry`.
pub(crate) fn format_expiry(unix_ts: i64) -> Result<String, ApiError> {
    let secs_per_day: i64 = 86400;
    let mut days = unix_ts / secs_per_day;
    let day_secs = ((unix_ts % secs_per_day) + secs_per_day) % secs_per_day;
    if unix_ts < 0 && day_secs > 0 {
        days -= 1;
    }
    let hour = day_secs / 3600;
    let min = (day_secs % 3600) / 60;
    let sec = day_secs % 60;
    let adj = days + 719468;
    let era = if adj >= 0 { adj } else { adj - 146096 } / 146097;
    let doe = adj - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    if !(1970..=9999).contains(&year) {
        return Err(ApiError::BadRequest(format!(
            "expiry timestamp {unix_ts} resolves to year {year}, out of supported range"
        )));
    }
    Ok(format!(
        "{year:04}-{m:02}-{d:02} {hour:02}:{min:02}:{sec:02}"
    ))
}
