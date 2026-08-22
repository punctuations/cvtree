use std::collections::HashMap;

use crate::model::Severity;

pub fn from_score(score: f64) -> Option<Severity> {
    match score {
        s if s >= 9.0 => Some(Severity::Critical),
        s if s >= 7.0 => Some(Severity::High),
        s if s >= 4.0 => Some(Severity::Medium),
        s if s > 0.0 => Some(Severity::Low),
        _ => None,
    }
}

pub fn from_label(label: &str) -> Option<Severity> {
    label.parse().ok()
}

pub fn cvss_v3_base_score(vector: &str) -> Option<f64> {
    if !vector.starts_with("CVSS:3") {
        return None;
    }

    let metrics: HashMap<&str, &str> = vector
        .split('/')
        .filter_map(|part| part.split_once(':'))
        .collect();

    let attack_vector = match *metrics.get("AV")? {
        "N" => 0.85,
        "A" => 0.62,
        "L" => 0.55,
        "P" => 0.2,
        _ => return None,
    };
    let attack_complexity = match *metrics.get("AC")? {
        "L" => 0.77,
        "H" => 0.44,
        _ => return None,
    };
    let scope_changed = match *metrics.get("S")? {
        "U" => false,
        "C" => true,
        _ => return None,
    };
    let privileges_required = match (*metrics.get("PR")?, scope_changed) {
        ("N", _) => 0.85,
        ("L", false) => 0.62,
        ("L", true) => 0.68,
        ("H", false) => 0.27,
        ("H", true) => 0.5,
        _ => return None,
    };
    let user_interaction = match *metrics.get("UI")? {
        "N" => 0.85,
        "R" => 0.62,
        _ => return None,
    };

    let impact_metric = |key: &str| -> Option<f64> {
        match metrics.get(key) {
            Some(&"H") => Some(0.56),
            Some(&"L") => Some(0.22),
            Some(&"N") => Some(0.0),
            _ => None,
        }
    };
    let confidentiality = impact_metric("C")?;
    let integrity = impact_metric("I")?;
    let availability = impact_metric("A")?;

    let impact_sub_score =
        1.0 - ((1.0 - confidentiality) * (1.0 - integrity) * (1.0 - availability));
    let impact = if scope_changed {
        7.52 * (impact_sub_score - 0.029) - 3.25 * (impact_sub_score - 0.02).powi(15)
    } else {
        6.42 * impact_sub_score
    };

    if impact <= 0.0 {
        return Some(0.0);
    }

    let exploitability =
        8.22 * attack_vector * attack_complexity * privileges_required * user_interaction;
    let base = if scope_changed {
        (1.08 * (impact + exploitability)).min(10.0)
    } else {
        (impact + exploitability).min(10.0)
    };

    Some(round_up(base))
}

fn round_up(value: f64) -> f64 {
    let scaled = (value * 100_000.0).round() as i64;
    if scaled % 10_000 == 0 {
        scaled as f64 / 100_000.0
    } else {
        ((scaled as f64 / 10_000.0).floor() + 1.0) / 10.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scores_known_vectors() {
        let cases = [
            ("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L", 5.3),
            ("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", 9.8),
            ("CVSS:3.1/AV:L/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H", 6.2),
            ("CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:C/C:L/I:L/A:N", 4.7),
            ("CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N", 0.0),
        ];
        for (vector, expected) in cases {
            assert_eq!(cvss_v3_base_score(vector), Some(expected), "{vector}");
        }
    }

    #[test]
    fn rejects_other_versions_and_junk() {
        assert_eq!(cvss_v3_base_score("CVSS:4.0/AV:N/AC:L/AT:N/PR:N"), None);
        assert_eq!(cvss_v3_base_score("AV:N/AC:L"), None);
        assert_eq!(cvss_v3_base_score("CVSS:3.1/AV:X/AC:L"), None);
    }

    #[test]
    fn maps_scores_to_ratings() {
        assert_eq!(from_score(9.8), Some(Severity::Critical));
        assert_eq!(from_score(7.0), Some(Severity::High));
        assert_eq!(from_score(6.9), Some(Severity::Medium));
        assert_eq!(from_score(3.9), Some(Severity::Low));
        assert_eq!(from_score(0.0), None);
    }

    #[test]
    fn maps_labels_to_ratings() {
        assert_eq!(from_label("MODERATE"), Some(Severity::Medium));
        assert_eq!(from_label("critical"), Some(Severity::Critical));
        assert_eq!(from_label("nonsense"), None);
    }
}
