use std::env;

pub(crate) fn is_production_runtime() -> bool {
    env::var("CLEAR_MSIG_ENV")
        .map(|value| value.eq_ignore_ascii_case("production"))
        .unwrap_or(false)
}
