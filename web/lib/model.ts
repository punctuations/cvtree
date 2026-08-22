export type Ecosystem = "npm" | "crates.io" | "PyPI";

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

export interface Dependency {
  name: string;
  version: string;
  ecosystem: Ecosystem;
}

export interface AffectedRange {
  introduced?: string;
  fixed?: string;
  last_affected?: string;
}

export interface Reference {
  kind: string;
  url: string;
}

export interface Vulnerability {
  id: string;
  aliases?: string[];
  package: Dependency;
  summary?: string;
  details?: string;
  severity?: Severity | null;
  cvss_score?: number;
  cvss_vector?: string;
  affected?: AffectedRange[];
  fixed_versions?: string[];
  references?: Reference[];
  published?: string;
  modified?: string;
  withdrawn?: string;
}

export interface PackageReport {
  package: string;
  version: string;
  ecosystem: Ecosystem;
  vulnerability_count: number;
  max_severity: Severity | null;
  vulnerabilities: Vulnerability[];
}

export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
}

export interface Finding {
  package: string;
  version: string;
  ecosystem: Ecosystem;
  id: string;
  aliases?: string[];
  severity: Severity | null;
  cvss_score?: number;
  summary?: string;
  fixed_versions?: string[];
  affected?: AffectedRange[];
  references?: Reference[];
  path: string[];
}

export interface UnresolvedRequirement {
  name: string;
  range: string;
  parent: string;
  reason: string;
}

export interface DeepReport {
  package: string;
  version: string;
  ecosystem: Ecosystem;
  depth: number;
  requested_depth: number;
  dependencies: number;
  vulnerable_dependencies: number;
  summary: SeverityCounts;
  max_severity: Severity | null;
  truncated: boolean;
  unresolved: UnresolvedRequirement[];
  vulnerabilities: Finding[];
}

export function emptyCounts(): SeverityCounts {
  return { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
}

export function recordSeverity(counts: SeverityCounts, severity: Severity | null | undefined) {
  switch (severity) {
    case "CRITICAL":
      counts.critical += 1;
      break;
    case "HIGH":
      counts.high += 1;
      break;
    case "MEDIUM":
      counts.medium += 1;
      break;
    case "LOW":
      counts.low += 1;
      break;
    default:
      counts.unknown += 1;
  }
}

export function highestSeverity(
  severities: (Severity | null | undefined)[],
): Severity | null {
  let highest: Severity | null = null;

  for (const severity of severities) {
    if (severity && (!highest || SEVERITY_RANK[severity] > SEVERITY_RANK[highest])) {
      highest = severity;
    }
  }

  return highest;
}

export function coordinate(dependency: Dependency): string {
  return `${dependency.name}@${dependency.version}`;
}

export function isTransitive(finding: Finding): boolean {
  return finding.path.length > 1;
}

export function describeRange(range: AffectedRange): string {
  const parts: string[] = [];
  const introduced = range.introduced;

  if (introduced && introduced !== "0" && introduced !== "0.0.0" && introduced !== "0.0.0-0") {
    parts.push(`>= ${introduced}`);
  }
  if (range.fixed) {
    parts.push(`< ${range.fixed}`);
  } else if (range.last_affected) {
    parts.push(`<= ${range.last_affected}`);
  }

  return parts.length > 0 ? parts.join(", ") : "all versions";
}

export function identifiers(vulnerability: Vulnerability): string[] {
  const cves = (vulnerability.aliases ?? []).filter((alias) => alias.startsWith("CVE-"));
  return [...new Set([...cves, vulnerability.id])];
}

export function advisoryUrl(vulnerability: Vulnerability): string | null {
  const references = vulnerability.references ?? [];
  const advisory = references.find((reference) => reference.kind === "ADVISORY");
  return (advisory ?? references[0])?.url ?? null;
}
