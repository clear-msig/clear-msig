pub const BOLD: &str = "\x1b[1m";
pub const RESET: &str = "\x1b[0m";
pub const CYAN: &str = "\x1b[36m";
pub const GREEN: &str = "\x1b[32m";
pub const YELLOW: &str = "\x1b[33m";

pub fn log(step: &str, msg: &str) {
    println!("{CYAN}[{step}]{RESET} {msg}");
}

pub fn ok(msg: &str) {
    println!("{GREEN}  \u{2713}{RESET} {msg}");
}

pub fn val(label: &str, v: impl std::fmt::Display) {
    println!("{YELLOW}  \u{2192}{RESET} {label}: {v}");
}
