export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

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
}

export interface PackageReport {
  package: string;
  version: string;
  ecosystem: string;
  vulnerability_count: number;
  max_severity: Severity | null;
  vulnerabilities: Vulnerability[];
}

export const API_BASE_URL = process.env.NEXT_PUBLIC_CVTREE_API ?? "";

export async function fetchReport(query: string): Promise<PackageReport> {
  const url = `${API_BASE_URL}/api/search?q=${encodeURIComponent(query)}`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error(
      API_BASE_URL
        ? `Could not reach the cvtree API at ${API_BASE_URL}.`
        : "Could not reach the cvtree API.",
    );
  }

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      body && typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
    throw new Error(message);
  }

  return body as PackageReport;
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
