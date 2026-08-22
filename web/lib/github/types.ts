export interface GithubIdentifier {
  type?: string;
  value?: string;
}

export interface GithubCvss {
  vector_string?: string | null;
  score?: number | null;
}

export interface GithubAffectedPackage {
  ecosystem?: string;
  name?: string;
}

export interface GithubVulnerability {
  package?: GithubAffectedPackage | null;
  vulnerable_version_range?: string | null;
  patched_versions?: string | null;
}

export interface GithubAdvisory {
  ghsa_id: string;
  cve_id?: string | null;
  html_url?: string;
  summary?: string;
  description?: string;
  severity?: string | null;
  identifiers?: GithubIdentifier[];
  cvss?: GithubCvss | null;
  cvss_severities?: { cvss_v3?: GithubCvss | null; cvss_v4?: GithubCvss | null } | null;
  vulnerabilities?: GithubVulnerability[] | null;
  published_at?: string | null;
  updated_at?: string | null;
  withdrawn_at?: string | null;
}
