import {
  SEVERITY_RANK,
  type AffectedRange,
  type Dependency,
  type Severity,
  type Vulnerability,
} from "@/lib/model";

import { cvssV3BaseScore, severityFromLabel, severityFromScore } from "./severity";
import type { OsvAffected, OsvEvent, OsvVulnerability } from "./types";

export function normalizeAll(
  raw: OsvVulnerability[],
  dependency: Dependency,
): Vulnerability[] {
  const seen = new Set<string>();
  const vulnerabilities: Vulnerability[] = [];

  for (const item of raw) {
    if (item.withdrawn || seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    vulnerabilities.push(normalize(item, dependency));
  }

  vulnerabilities.sort((a, b) => rank(b.severity) - rank(a.severity) || a.id.localeCompare(b.id));

  return vulnerabilities;
}

function rank(severity: Severity | null | undefined): number {
  return severity ? SEVERITY_RANK[severity] : 0;
}

export function normalize(raw: OsvVulnerability, dependency: Dependency): Vulnerability {
  const entries = (raw.affected ?? []).filter((entry) => matchesPackage(entry, dependency));

  const affected: AffectedRange[] = [];
  const fixedVersions: string[] = [];

  for (const entry of entries) {
    for (const range of entry.ranges ?? []) {
      if (range.type === "GIT") {
        continue;
      }
      for (const item of rangesFromEvents(range.events ?? [])) {
        if (item.fixed && !fixedVersions.includes(item.fixed)) {
          fixedVersions.push(item.fixed);
        }
        if (!affected.some((existing) => sameRange(existing, item))) {
          affected.push(item);
        }
      }
    }

    const versions = entry.versions ?? [];
    if ((entry.ranges ?? []).length === 0 && versions.length > 0) {
      const item: AffectedRange = {
        introduced: versions[0],
        last_affected: versions[versions.length - 1],
      };
      if (!affected.some((existing) => sameRange(existing, item))) {
        affected.push(item);
      }
    }
  }

  const vectors = [...(raw.severity ?? []), ...entries.flatMap((entry) => entry.severity ?? [])];

  let cvssVector: string | undefined;
  let cvssScore: number | undefined;
  for (const candidate of vectors) {
    if (candidate.type !== "CVSS_V3" || !candidate.score) {
      continue;
    }
    const score = cvssV3BaseScore(candidate.score);
    if (score !== null) {
      cvssVector = candidate.score;
      cvssScore = score;
      break;
    }
  }

  const severity =
    (cvssScore !== undefined ? severityFromScore(cvssScore) : null) ??
    databaseSpecificSeverity(raw);

  const aliases = raw.aliases ?? [];
  const references = (raw.references ?? []).map((reference) => ({
    kind: reference.type ?? "",
    url: reference.url,
  }));

  return {
    id: raw.id,
    aliases: aliases.length > 0 ? aliases : undefined,
    package: dependency,
    summary: raw.summary,
    details: raw.details,
    severity: severity ?? undefined,
    cvss_score: cvssScore,
    cvss_vector: cvssVector,
    affected: affected.length > 0 ? affected : undefined,
    fixed_versions: fixedVersions.length > 0 ? fixedVersions : undefined,
    references: references.length > 0 ? references : undefined,
    published: raw.published,
    modified: raw.modified,
    withdrawn: raw.withdrawn,
  };
}

function matchesPackage(entry: OsvAffected, dependency: Dependency): boolean {
  const osv = entry.package;
  if (!osv) {
    return false;
  }

  const ecosystem = (osv.ecosystem ?? "").split(":")[0];
  return (
    osv.name.toLowerCase() === dependency.name.toLowerCase() &&
    ecosystem === dependency.ecosystem
  );
}

function databaseSpecificSeverity(raw: OsvVulnerability): Severity | null {
  const label = raw.database_specific?.severity;
  return typeof label === "string" ? severityFromLabel(label) : null;
}

function sameRange(a: AffectedRange, b: AffectedRange): boolean {
  return (
    a.introduced === b.introduced &&
    a.fixed === b.fixed &&
    a.last_affected === b.last_affected
  );
}

function rangesFromEvents(events: OsvEvent[]): AffectedRange[] {
  const ranges: AffectedRange[] = [];
  let current: AffectedRange | null = null;

  for (const event of events) {
    if (event.introduced !== undefined) {
      if (current) {
        ranges.push(current);
      }
      current = { introduced: event.introduced };
    }
    if (event.fixed !== undefined) {
      const range = current ?? {};
      current = null;
      ranges.push({ ...range, fixed: event.fixed });
    }
    if (event.last_affected !== undefined) {
      const range = current ?? {};
      current = null;
      ranges.push({ ...range, last_affected: event.last_affected });
    }
  }

  if (current) {
    ranges.push(current);
  }

  return ranges;
}
