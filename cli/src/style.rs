use std::io::IsTerminal;
use std::sync::OnceLock;

use cvtree::Severity;

static ENABLED: OnceLock<bool> = OnceLock::new();

pub fn init(disable: bool) {
    let enabled = !disable
        && std::env::var_os("NO_COLOR").is_none()
        && (std::env::var_os("CLICOLOR_FORCE").is_some() || std::io::stdout().is_terminal());
    let _ = ENABLED.set(enabled);
}

fn paint(code: &str, text: &str) -> String {
    if *ENABLED.get().unwrap_or(&false) {
        format!("\u{1b}[{code}m{text}\u{1b}[0m")
    } else {
        text.to_string()
    }
}

pub fn bold(text: &str) -> String {
    paint("1", text)
}

pub fn dim(text: &str) -> String {
    paint("2", text)
}

pub fn cyan(text: &str) -> String {
    paint("36", text)
}

pub fn green(text: &str) -> String {
    paint("32", text)
}

pub fn red(text: &str) -> String {
    paint("31", text)
}

pub fn severity(severity: Option<Severity>, text: &str) -> String {
    let code = match severity {
        Some(Severity::Critical) => "1;35",
        Some(Severity::High) => "1;31",
        Some(Severity::Medium) => "1;33",
        Some(Severity::Low) => "1;36",
        None => "1;2",
    };
    paint(code, text)
}

pub fn severity_label(value: Option<Severity>) -> &'static str {
    match value {
        Some(level) => level.label(),
        None => "UNKNOWN",
    }
}
