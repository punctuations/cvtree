use cvtree::audit::{AuditReport, Finding};
use cvtree::{Dependency, Severity, Vulnerability};

use crate::style;

const RULE: &str = "────────────────────────────────────────────";

pub fn search(package: &Dependency, vulnerabilities: &[Vulnerability]) -> String {
    let mut out = String::new();
    out.push_str(&format!("\n{}\n", style::bold(&package.to_string())));
    out.push_str(&format!("{}\n\n", style::dim(package.ecosystem.osv_name())));

    if vulnerabilities.is_empty() {
        out.push_str(&format!(
            "{}\n",
            style::green(&format!("No known vulnerabilities for {package}."))
        ));
        return out;
    }

    out.push_str(&format!(
        "{}\n",
        style::bold(&count_line(vulnerabilities.len()))
    ));

    for vulnerability in vulnerabilities {
        out.push_str(&format!("\n{RULE}\n\n"));
        out.push_str(&format!(
            "  {}  {}\n",
            style::severity(
                vulnerability.severity,
                style::severity_label(vulnerability.severity)
            ),
            style::dim(&identifiers(vulnerability))
        ));
        out.push_str(&format!("\n  {}\n", vulnerability.title()));

        let affected = vulnerability
            .affected
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(" | ");
        if !affected.is_empty() {
            out.push_str(&format!("\n  Affected: {affected}\n"));
        }
        if !vulnerability.fixed_versions.is_empty() {
            out.push_str(&format!(
                "  Fixed in: {}\n",
                vulnerability.fixed_versions.join(", ")
            ));
        }
        if let Some(reference) = vulnerability.primary_reference() {
            out.push_str(&format!("\n  {}\n", style::cyan(&reference.url)));
        }
    }

    out.push_str(&format!("\n{RULE}\n\n{}\n", count_line(vulnerabilities.len())));
    out
}

fn identifiers(vulnerability: &Vulnerability) -> String {
    let mut parts = vec![vulnerability.id.clone()];
    if let Some(cve) = vulnerability.cve() {
        if cve != vulnerability.id {
            parts.insert(0, cve.to_string());
        }
    }
    parts.join("  ")
}

pub fn audit(report: &AuditReport) -> String {
    let mut out = String::new();
    out.push_str(&format!("\n{RULE}\n\n"));
    out.push_str(&format!("Project:   {}\n", style::bold(&report.project)));
    out.push_str(&format!("Ecosystem: {}\n\n", report.ecosystem));
    out.push_str(&format!("Dependencies: {}\n", report.dependency_count));
    out.push_str(&format!(
        "Vulnerable:   {}\n",
        report.vulnerable_dependencies
    ));

    if report.summary.total() > 0 {
        out.push('\n');
        for level in Severity::ALL {
            let count = report.summary.count(level);
            let line = format!("  {:<9} {count}", level.label());
            out.push_str(&format!(
                "{}\n",
                if count > 0 {
                    style::severity(Some(level), &line)
                } else {
                    style::dim(&line)
                }
            ));
        }
        if report.summary.unknown > 0 {
            out.push_str(&format!("  {:<9} {}\n", "UNKNOWN", report.summary.unknown));
        }
    }

    if report.vulnerabilities.is_empty() {
        out.push_str(&format!("\n{RULE}\n\n"));
        out.push_str(&format!(
            "{}\n",
            style::green("No known vulnerabilities found.")
        ));
        return out;
    }

    let groups = Severity::ALL
        .into_iter()
        .map(Some)
        .chain(std::iter::once(None));

    for level in groups {
        let findings = report.findings_by_severity(level);
        if findings.is_empty() {
            continue;
        }
        out.push_str(&format!("\n{RULE}\n\n"));
        out.push_str(&format!(
            "{}\n",
            style::severity(level, style::severity_label(level))
        ));
        for finding in findings {
            out.push_str(&format!("\n{}", finding_block(finding)));
        }
    }

    out.push_str(&format!("\n{RULE}\n\n{}\n", count_line(report.vulnerabilities.len())));
    out
}

fn finding_block(finding: &Finding) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "  {}\n",
        style::bold(&format!("{}@{}", finding.package, finding.version))
    ));
    out.push_str(&format!("  {}\n", style::dim(&finding_identifiers(finding))));

    if let Some(summary) = &finding.summary {
        out.push_str(&format!("\n  {summary}\n"));
    }
    if !finding.fixed_versions.is_empty() {
        out.push_str(&format!(
            "\n  Fixed in: {}\n",
            finding.fixed_versions.join(", ")
        ));
    }
    if finding.is_transitive() {
        out.push_str(&format!(
            "  {}\n",
            style::dim(&format!("Path: {}", finding.path.join(" > ")))
        ));
    }
    out
}

fn finding_identifiers(finding: &Finding) -> String {
    let mut parts = vec![finding.id.clone()];
    if let Some(cve) = finding
        .aliases
        .iter()
        .find(|alias| alias.starts_with("CVE-"))
    {
        if cve != &finding.id {
            parts.insert(0, cve.clone());
        }
    }
    parts.join("  ")
}

fn count_line(count: usize) -> String {
    if count == 1 {
        "1 vulnerability found.".to_string()
    } else {
        format!("{count} vulnerabilities found.")
    }
}

pub fn tree(report: &AuditReport) -> String {
    let mut out = String::new();
    out.push_str(&format!("\n{}\n", style::bold(&report.project)));
    for finding in &report.vulnerabilities {
        let depth = finding.path.len().saturating_sub(1);
        for (index, entry) in finding.path.iter().skip(1).enumerate() {
            let indent = "  ".repeat(index + 1);
            let branch = if index + 1 == depth { "└── " } else { "├── " };
            out.push_str(&format!("{indent}{branch}{entry}\n"));
        }
        let indent = "  ".repeat(depth + 1);
        out.push_str(&format!(
            "{indent}{} {}\n",
            style::severity(finding.severity, "!"),
            style::severity(
                finding.severity,
                &format!("{} {}", style::severity_label(finding.severity), finding.identifier())
            )
        ));
    }
    out
}

pub fn error(message: &str) -> String {
    format!("{} {message}", style::red("error:"))
}
