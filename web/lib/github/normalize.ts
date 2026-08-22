import type { AffectedRange, Dependency, Ecosystem, RepoAdvisory } from "@/lib/model";
import { cvssV3BaseScore, severityFromLabel, severityFromScore } from "@/lib/osv/severity";

import type { GithubAdvisory, GithubVulnerability } from "./types";

const ECOSYSTEMS: Record<string, Ecosystem> = {
  npm: "npm",
  rust: "crates.io",
  pip: "PyPI",
};

export function normalizeAdvisory(raw: GithubAdvisory): RepoAdvisory {
  const aliases = (raw.identifiers ?? [])
    .map((identifier) => identifier.value)
    .filter((value): value is string => typeof value === "string" && value !== raw.ghsa_id);

  const vector = raw.cvss?.vector_string ?? raw.cvss_severities?.cvss_v3?.vector_string ?? null;
  const derived = vector ? cvssV3BaseScore(vector) : null;
  const reported = raw.cvss?.score ?? raw.cvss_severities?.cvss_v3?.score ?? null;
  const score = derived ?? (typeof reported === "number" && reported > 0 ? reported : null);

  const severity =
    (score !== null ? severityFromScore(score) : null) ??
    (raw.severity ? severityFromLabel(raw.severity) : null);

  const affected: AffectedRange[] = [];
  const fixed: string[] = [];
  const packages: Dependency[] = [];

  for (const entry of raw.vulnerabilities ?? []) {
    const range = parseRange(entry.vulnerable_version_range);
    if (range && !affected.some((existing) => sameRange(existing, range))) {
      affected.push(range);
    }

    const patched = version(entry.patched_versions);
    if (patched && !fixed.includes(patched)) {
      fixed.push(patched);
    }

    const dependency = toDependency(entry);
    if (dependency && !packages.some((existing) => sameDependency(existing, dependency))) {
      packages.push(dependency);
    }
  }

  return {
    id: raw.ghsa_id,
    aliases: aliases.length > 0 ? aliases : undefined,
    sources: ["GitHub"],
    summary: raw.summary,
    details: raw.description,
    severity: severity ?? undefined,
    cvss_score: score ?? undefined,
    cvss_vector: vector ?? undefined,
    affected: affected.length > 0 ? affected : undefined,
    fixed_versions: fixed.length > 0 ? fixed : undefined,
    affected_packages: packages.length > 0 ? packages : undefined,
    references: raw.html_url ? [{ kind: "ADVISORY", url: raw.html_url }] : undefined,
    published: raw.published_at ?? undefined,
    modified: raw.updated_at ?? undefined,
    withdrawn: raw.withdrawn_at ?? undefined,
  };
}

function version(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || /^[0-9a-f]{40}$/i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function toDependency(entry: GithubVulnerability): Dependency | null {
  const name = entry.package?.name;
  const ecosystem = ECOSYSTEMS[(entry.package?.ecosystem ?? "").toLowerCase()];

  if (!name || !ecosystem) {
    return null;
  }

  return { name, version: version(entry.patched_versions) ?? "", ecosystem };
}

function parseRange(range: string | null | undefined): AffectedRange | null {
  if (!range) {
    return null;
  }

  const parsed: AffectedRange = {};

  for (const part of range.split(",")) {
    const match = part.trim().match(/^(>=|>|<=|<|=)\s*(.+)$/);
    if (!match) {
      continue;
    }

    const [, operator, version] = match;
    if (operator === ">=" || operator === ">" || operator === "=") {
      parsed.introduced = version;
    } else if (operator === "<") {
      parsed.fixed = version;
    } else {
      parsed.last_affected = version;
    }
  }

  return parsed.introduced || parsed.fixed || parsed.last_affected ? parsed : null;
}

function sameRange(a: AffectedRange, b: AffectedRange): boolean {
  return a.introduced === b.introduced && a.fixed === b.fixed && a.last_affected === b.last_affected;
}

function sameDependency(a: Dependency, b: Dependency): boolean {
  return a.name === b.name && a.ecosystem === b.ecosystem;
}
