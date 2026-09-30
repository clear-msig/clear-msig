use std::env;

pub(crate) fn is_production_runtime() -> bool {
    env::var("CLEAR_MSIG_ENV")
        .map(|value| is_production_value(&value))
        .unwrap_or(false)
}

fn is_production_value(value: &str) -> bool {
    value.trim().eq_ignore_ascii_case("production")
}

#[cfg(test)]
mod tests {
    use super::is_production_value;

    #[test]
    fn production_guards_agree_for_case_and_whitespace_variants() {
        for value in ["production", "Production", "PRODUCTION", " production "] {
            assert!(is_production_value(value));
        }
        for value in ["", "development", "staging", "not-production"] {
            assert!(!is_production_value(value));
        }
    }
}
