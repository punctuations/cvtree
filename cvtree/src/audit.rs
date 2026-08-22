use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::model::{
    AffectedRange, Dependency, DependencyTree, Ecosystem, Reference, Severity, Vulnerability,
};
use crate::parser;
use crate::source::VulnerabilitySource;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SeverityCounts {
    pub critical: usize,
    pub high: usize,
    pub medium: usize,
    pub low: usize,
    pub unknown: usize,
}

impl SeverityCounts {
    pub fn count(&self, severity: Severity) -> usize {
        match severity {
            Severity::Critical => self.critical,
            Severity::High => self.high,
            Severity::Medium => self.medium,
            Severity::Low => self.low,
        }
    }

    fn record(&mut self, severity: Option<Severity>) {
        match severity {
            Some(Severity::Critical) => self.critical += 1,
            Some(Severity::High) => self.high += 1,
            Some(Severity::Medium) => self.medium += 1,
            Some(Severity::Low) => self.low += 1,
            None => self.unknown += 1,
        }
    }

    pub fn total(&self) -> usize {
        self.critical + self.high + self.medium + self.low + self.unknown
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Finding {
    pub package: String,
    pub version: String,
    pub ecosystem: Ecosystem,
    pub id: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<String>,
    pub severity: Option<Severity>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cvss_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fixed_versions: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub affected: Vec<AffectedRange>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub references: Vec<Reference>,
    pub path: Vec<String>,
}

impl Finding {
    fn new(vulnerability: Vulnerability, path: Vec<String>) -> Self {
        Finding {
            package: vulnerability.package.name.clone(),
            version: vulnerability.package.version.clone(),
            ecosystem: vulnerability.package.ecosystem,
            id: vulnerability.id,
            aliases: vulnerability.aliases,
            severity: vulnerability.severity,
            cvss_score: vulnerability.cvss_score,
            summary: vulnerability.summary,
            fixed_versions: vulnerability.fixed_versions,
            affected: vulnerability.affected,
            references: vulnerability.references,
            path,
        }
    }

    pub fn identifier(&self) -> &str {
        self.aliases
            .iter()
            .map(String::as_str)
            .find(|alias| alias.starts_with("CVE-"))
            .unwrap_or(&self.id)
    }

    pub fn advisory_url(&self) -> Option<&str> {
        self.references
            .iter()
            .find(|reference| reference.kind == "ADVISORY")
            .or_else(|| self.references.first())
            .map(|reference| reference.url.as_str())
    }

    pub fn is_transitive(&self) -> bool {
        self.path.len() > 2
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditReport {
    pub project: String,
    pub ecosystem: Ecosystem,
    #[serde(rename = "dependencies")]
    pub dependency_count: usize,
    pub vulnerable_dependencies: usize,
    pub summary: SeverityCounts,
    pub vulnerabilities: Vec<Finding>,
}

impl AuditReport {
    pub fn max_severity(&self) -> Option<Severity> {
        self.vulnerabilities
            .iter()
            .filter_map(|finding| finding.severity)
            .max()
    }

    pub fn fails(&self, threshold: Severity) -> bool {
        self.vulnerabilities.iter().any(|finding| {
            finding
                .severity
                .is_some_and(|severity| severity >= threshold)
        })
    }

    pub fn findings_by_severity(&self, severity: Option<Severity>) -> Vec<&Finding> {
        self.vulnerabilities
            .iter()
            .filter(|finding| finding.severity == severity)
            .collect()
    }
}

pub async fn audit_project(root: &Path, source: &dyn VulnerabilitySource) -> Result<AuditReport> {
    let project = parser::discover(root)?;
    let tree = project.parser.parse(&project.root)?;
    audit_tree(&tree, source).await
}

pub async fn audit_tree(
    tree: &DependencyTree,
    source: &dyn VulnerabilitySource,
) -> Result<AuditReport> {
    let dependencies = tree.dependencies();
    let results = source.query_batch(&dependencies).await?;

    let mut summary = SeverityCounts::default();
    let mut vulnerabilities = Vec::new();
    let mut vulnerable_dependencies = 0;

    for (dependency, found) in dependencies.iter().zip(results) {
        if found.is_empty() {
            continue;
        }
        vulnerable_dependencies += 1;
        let path = introduction_path(tree, dependency);
        for vulnerability in found {
            summary.record(vulnerability.severity);
            vulnerabilities.push(Finding::new(vulnerability, path.clone()));
        }
    }

    vulnerabilities.sort_by(|a, b| {
        b.severity
            .cmp(&a.severity)
            .then_with(|| a.package.cmp(&b.package))
            .then_with(|| a.id.cmp(&b.id))
    });

    Ok(AuditReport {
        project: tree.project.clone(),
        ecosystem: tree.ecosystem,
        dependency_count: dependencies.len(),
        vulnerable_dependencies,
        summary,
        vulnerabilities,
    })
}

fn introduction_path(tree: &DependencyTree, dependency: &Dependency) -> Vec<String> {
    let mut path = vec![tree.project.clone()];
    if let Some(id) = tree.find(dependency) {
        path.extend(tree.path_to(id).into_iter().map(Dependency::to_string));
    } else {
        path.push(dependency.to_string());
    }
    path
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackageReport {
    pub package: String,
    pub version: String,
    pub ecosystem: Ecosystem,
    pub vulnerability_count: usize,
    pub max_severity: Option<Severity>,
    pub vulnerabilities: Vec<Vulnerability>,
}

impl PackageReport {
    pub fn new(package: &Dependency, vulnerabilities: Vec<Vulnerability>) -> Self {
        PackageReport {
            package: package.name.clone(),
            version: package.version.clone(),
            ecosystem: package.ecosystem,
            vulnerability_count: vulnerabilities.len(),
            max_severity: vulnerabilities
                .iter()
                .filter_map(|item| item.severity)
                .max(),
            vulnerabilities,
        }
    }
}
