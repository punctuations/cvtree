use std::path::Path;

use cvtree::model::{Dependency, Ecosystem, Severity};
use cvtree::source::osv::{normalize_all, OsvBatchResponse, OsvQueryResponse, OsvVulnerability};
use cvtree::Vulnerability;

fn fixture(name: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/osv")
        .join(name);
    std::fs::read_to_string(&path).unwrap_or_else(|err| panic!("{}: {err}", path.display()))
}

fn query(name: &str) -> OsvQueryResponse {
    serde_json::from_str(&fixture(name)).expect("parse OSV query response")
}

fn find<'a>(vulnerabilities: &'a [Vulnerability], id: &str) -> &'a Vulnerability {
    vulnerabilities
        .iter()
        .find(|item| item.id == id)
        .unwrap_or_else(|| panic!("{id} missing"))
}

#[test]
fn parses_a_real_query_response() {
    let response = query("query-lodash-4.17.15.json");
    assert_eq!(response.vulns.len(), 6);

    let package = Dependency::new("lodash", "4.17.15", Ecosystem::Npm);
    let vulnerabilities = normalize_all(&response.vulns, &package);
    assert_eq!(vulnerabilities.len(), 6);

    let command_injection = find(&vulnerabilities, "GHSA-35jh-r3h4-6jhm");
    assert_eq!(command_injection.severity, Some(Severity::High));
    assert_eq!(command_injection.cve(), Some("CVE-2021-23337"));
    assert_eq!(command_injection.package, package);
    assert_eq!(command_injection.fixed_versions, vec!["4.17.21"]);
    assert!(command_injection.summary.is_some());
    assert!(command_injection
        .references
        .iter()
        .any(|reference| reference.kind == "ADVISORY"));
}

#[test]
fn derives_severity_from_the_cvss_vector() {
    let package = Dependency::new("lodash", "4.17.15", Ecosystem::Npm);
    let vulnerabilities = normalize_all(&query("query-lodash-4.17.15.json").vulns, &package);

    let redos = find(&vulnerabilities, "GHSA-29mw-wpgm-hmr9");
    assert_eq!(
        redos.cvss_vector.as_deref(),
        Some("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L")
    );
    assert_eq!(redos.cvss_score, Some(5.3));
    assert_eq!(redos.severity, Some(Severity::Medium));
}

#[test]
fn falls_back_to_the_advisory_severity_label() {
    let package = Dependency::new("demo-pkg", "1.1.0", Ecosystem::Npm);
    let vulnerabilities = normalize_all(&query("query-edge-cases.json").vulns, &package);

    let labelled = find(&vulnerabilities, "GHSA-label-only-0001");
    assert_eq!(labelled.severity, Some(Severity::Medium));
    assert_eq!(labelled.cvss_score, None);
}

#[test]
fn keeps_only_ranges_for_the_queried_package() {
    let package = Dependency::new("demo-pkg", "1.1.0", Ecosystem::Npm);
    let vulnerabilities = normalize_all(&query("query-edge-cases.json").vulns, &package);

    let labelled = find(&vulnerabilities, "GHSA-label-only-0001");
    let ranges: Vec<String> = labelled.affected.iter().map(ToString::to_string).collect();
    assert_eq!(ranges, vec![">= 1.0.0, < 1.2.0", ">= 2.0.0, < 2.1.3"]);
    assert_eq!(labelled.fixed_versions, vec!["1.2.0", "2.1.3"]);
}

#[test]
fn drops_withdrawn_advisories() {
    let package = Dependency::new("demo-pkg", "1.1.0", Ecosystem::Npm);
    let vulnerabilities = normalize_all(&query("query-edge-cases.json").vulns, &package);

    assert!(!vulnerabilities
        .iter()
        .any(|item| item.id == "GHSA-withdrawn-0002"));
}

#[test]
fn handles_version_lists_and_missing_severity() {
    let package = Dependency::new("demo-pkg", "1.5.1", Ecosystem::Npm);
    let vulnerabilities = normalize_all(&query("query-edge-cases.json").vulns, &package);

    let listed = find(&vulnerabilities, "GHSA-versions-only-0003");
    assert_eq!(listed.severity, Some(Severity::Critical));
    assert_eq!(listed.affected.len(), 1);
    assert_eq!(listed.affected[0].introduced.as_deref(), Some("1.5.0"));
    assert_eq!(listed.affected[0].last_affected.as_deref(), Some("1.5.2"));

    let unrated = find(&vulnerabilities, "GHSA-unrated-0004");
    assert_eq!(unrated.severity, None);
    assert_eq!(unrated.affected[0].to_string(), "<= 3.0.1");
}

#[test]
fn orders_results_by_severity() {
    let package = Dependency::new("demo-pkg", "1.1.0", Ecosystem::Npm);
    let vulnerabilities = normalize_all(&query("query-edge-cases.json").vulns, &package);

    let severities: Vec<Option<Severity>> = vulnerabilities.iter().map(|item| item.severity).collect();
    assert_eq!(
        severities,
        vec![
            Some(Severity::Critical),
            Some(Severity::Medium),
            None
        ]
    );
}

#[test]
fn normalizes_a_rustsec_advisory() {
    let raw: OsvVulnerability =
        serde_json::from_str(&fixture("vuln-rustsec-2020-0071.json")).expect("parse advisory");
    let package = Dependency::new("time", "0.1.44", Ecosystem::CratesIo);
    let vulnerabilities = normalize_all(std::slice::from_ref(&raw), &package);

    let advisory = find(&vulnerabilities, "RUSTSEC-2020-0071");
    assert_eq!(advisory.severity, Some(Severity::Medium));
    assert_eq!(advisory.cvss_score, Some(6.2));
    assert_eq!(advisory.package.ecosystem, Ecosystem::CratesIo);
    assert!(advisory.fixed_versions.contains(&"0.2.23".to_string()));
    assert!(advisory.summary.as_deref().is_some_and(|s| s.contains("segfault")));
}

#[test]
fn parses_a_batch_response() {
    let response: OsvBatchResponse =
        serde_json::from_str(&fixture("querybatch.json")).expect("parse batch response");

    assert_eq!(response.results.len(), 3);
    assert_eq!(response.results[0].vulns.len(), 6);
    assert!(response.results[1]
        .vulns
        .iter()
        .any(|item| item.id == "RUSTSEC-2020-0071"));
    assert!(response.results[2].vulns.is_empty());
}
