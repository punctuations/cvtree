use serde::Deserialize;

use crate::model::{AffectedRange, Dependency, Reference, Severity, Vulnerability};
use crate::severity;

#[derive(Debug, Clone, Deserialize)]
pub struct OsvVulnerability {
    pub id: String,
    pub summary: Option<String>,
    pub details: Option<String>,
    #[serde(default)]
    pub aliases: Vec<String>,
    pub published: Option<String>,
    pub modified: Option<String>,
    pub withdrawn: Option<String>,
    #[serde(default)]
    pub severity: Vec<OsvSeverity>,
    #[serde(default)]
    pub references: Vec<OsvReference>,
    #[serde(default)]
    pub affected: Vec<OsvAffected>,
    pub database_specific: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OsvSeverity {
    #[serde(rename = "type", default)]
    pub kind: String,
    #[serde(default)]
    pub score: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OsvReference {
    #[serde(rename = "type", default)]
    pub kind: String,
    pub url: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OsvAffected {
    pub package: Option<OsvPackage>,
    #[serde(default)]
    pub ranges: Vec<OsvRange>,
    #[serde(default)]
    pub versions: Vec<String>,
    #[serde(default)]
    pub severity: Vec<OsvSeverity>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OsvPackage {
    pub name: String,
    #[serde(default)]
    pub ecosystem: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OsvRange {
    #[serde(rename = "type", default)]
    pub kind: String,
    #[serde(default)]
    pub events: Vec<OsvEvent>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct OsvEvent {
    pub introduced: Option<String>,
    pub fixed: Option<String>,
    pub last_affected: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct OsvQueryResponse {
    #[serde(default)]
    pub vulns: Vec<OsvVulnerability>,
    pub next_page_token: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct OsvBatchResponse {
    #[serde(default)]
    pub results: Vec<OsvBatchResult>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct OsvBatchResult {
    #[serde(default)]
    pub vulns: Vec<OsvBatchVulnerability>,
    pub next_page_token: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OsvBatchVulnerability {
    pub id: String,
    pub modified: Option<String>,
}

pub fn normalize_all(raw: &[OsvVulnerability], package: &Dependency) -> Vec<Vulnerability> {
    let mut vulnerabilities: Vec<Vulnerability> = raw
        .iter()
        .filter(|item| item.withdrawn.is_none())
        .map(|item| normalize(item, package))
        .collect();

    vulnerabilities.sort_by(|a, b| b.severity.cmp(&a.severity).then_with(|| a.id.cmp(&b.id)));
    vulnerabilities.dedup_by(|a, b| a.id == b.id);
    vulnerabilities
}

pub fn normalize(raw: &OsvVulnerability, package: &Dependency) -> Vulnerability {
    let affected_entries: Vec<&OsvAffected> = raw
        .affected
        .iter()
        .filter(|affected| matches_package(affected, package))
        .collect();

    let mut affected = Vec::new();
    let mut fixed_versions = Vec::new();
    for entry in &affected_entries {
        for range in &entry.ranges {
            if range.kind == "GIT" {
                continue;
            }
            for item in ranges_from_events(&range.events) {
                if let Some(fixed) = &item.fixed {
                    if !fixed_versions.contains(fixed) {
                        fixed_versions.push(fixed.clone());
                    }
                }
                if !affected.contains(&item) {
                    affected.push(item);
                }
            }
        }
        if entry.ranges.is_empty() && !entry.versions.is_empty() {
            let item = AffectedRange {
                introduced: entry.versions.first().cloned(),
                last_affected: entry.versions.last().cloned(),
                ..AffectedRange::default()
            };
            if !affected.contains(&item) {
                affected.push(item);
            }
        }
    }

    let vectors = raw
        .severity
        .iter()
        .chain(affected_entries.iter().flat_map(|entry| entry.severity.iter()));
    let cvss = vectors
        .filter(|item| item.kind == "CVSS_V3")
        .find_map(|item| severity::cvss_v3_base_score(&item.score).map(|score| (item.score.clone(), score)));

    let (cvss_vector, cvss_score) = match cvss {
        Some((vector, score)) => (Some(vector), Some(score)),
        None => (None, None),
    };

    let rating = cvss_score
        .and_then(severity::from_score)
        .or_else(|| database_specific_severity(raw));

    Vulnerability {
        id: raw.id.clone(),
        aliases: raw.aliases.clone(),
        package: package.clone(),
        summary: raw.summary.clone(),
        details: raw.details.clone(),
        severity: rating,
        cvss_score,
        cvss_vector,
        affected,
        fixed_versions,
        references: raw
            .references
            .iter()
            .map(|reference| Reference {
                kind: reference.kind.clone(),
                url: reference.url.clone(),
            })
            .collect(),
        published: raw.published.clone(),
        modified: raw.modified.clone(),
        withdrawn: raw.withdrawn.clone(),
    }
}

fn matches_package(affected: &OsvAffected, package: &Dependency) -> bool {
    match &affected.package {
        Some(osv) => {
            osv.name.eq_ignore_ascii_case(&package.name)
                && osv.ecosystem.split(':').next().unwrap_or_default()
                    == package.ecosystem.osv_name()
        }
        None => false,
    }
}

fn database_specific_severity(raw: &OsvVulnerability) -> Option<Severity> {
    raw.database_specific
        .as_ref()?
        .get("severity")?
        .as_str()
        .and_then(severity::from_label)
}

fn ranges_from_events(events: &[OsvEvent]) -> Vec<AffectedRange> {
    let mut ranges = Vec::new();
    let mut current: Option<AffectedRange> = None;

    for event in events {
        if let Some(introduced) = &event.introduced {
            if let Some(open) = current.take() {
                ranges.push(open);
            }
            current = Some(AffectedRange {
                introduced: Some(introduced.clone()),
                ..AffectedRange::default()
            });
        }
        if let Some(fixed) = &event.fixed {
            let mut range = current.take().unwrap_or_default();
            range.fixed = Some(fixed.clone());
            ranges.push(range);
        }
        if let Some(last_affected) = &event.last_affected {
            let mut range = current.take().unwrap_or_default();
            range.last_affected = Some(last_affected.clone());
            ranges.push(range);
        }
    }

    if let Some(open) = current.take() {
        ranges.push(open);
    }
    ranges
}
