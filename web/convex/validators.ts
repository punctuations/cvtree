import { v } from "convex/values";

export const ecosystem = v.union(
  v.literal("npm"),
  v.literal("crates.io"),
  v.literal("PyPI"),
);

export const severity = v.union(
  v.literal("CRITICAL"),
  v.literal("HIGH"),
  v.literal("MEDIUM"),
  v.literal("LOW"),
);

export const affectedRange = v.object({
  introduced: v.optional(v.string()),
  fixed: v.optional(v.string()),
  last_affected: v.optional(v.string()),
});

export const reference = v.object({
  kind: v.string(),
  url: v.string(),
});

export const dependency = v.object({
  name: v.string(),
  version: v.string(),
  ecosystem,
});

export const vulnerability = v.object({
  id: v.string(),
  aliases: v.optional(v.array(v.string())),
  package: dependency,
  summary: v.optional(v.string()),
  details: v.optional(v.string()),
  severity: v.optional(v.union(severity, v.null())),
  cvss_score: v.optional(v.number()),
  cvss_vector: v.optional(v.string()),
  affected: v.optional(v.array(affectedRange)),
  fixed_versions: v.optional(v.array(v.string())),
  references: v.optional(v.array(reference)),
  published: v.optional(v.string()),
  modified: v.optional(v.string()),
  withdrawn: v.optional(v.string()),
});

export const packageReport = v.object({
  package: v.string(),
  version: v.string(),
  ecosystem,
  vulnerability_count: v.number(),
  max_severity: v.union(severity, v.null()),
  vulnerabilities: v.array(vulnerability),
});

export const finding = v.object({
  package: v.string(),
  version: v.string(),
  ecosystem,
  id: v.string(),
  aliases: v.optional(v.array(v.string())),
  severity: v.union(severity, v.null()),
  cvss_score: v.optional(v.number()),
  summary: v.optional(v.string()),
  fixed_versions: v.optional(v.array(v.string())),
  affected: v.optional(v.array(affectedRange)),
  references: v.optional(v.array(reference)),
  path: v.array(v.string()),
});

export const unresolvedRequirement = v.object({
  name: v.string(),
  range: v.string(),
  parent: v.string(),
  reason: v.string(),
});

export const severityCounts = v.object({
  critical: v.number(),
  high: v.number(),
  medium: v.number(),
  low: v.number(),
  unknown: v.number(),
});

export const packageTrust = v.object({
  name: v.string(),
  version: v.string(),
  ecosystem,
  depth: v.number(),
  path: v.array(v.string()),
  advisories: v.number(),
  versions: v.number(),
  vulnerability_count: v.number(),
  trust: v.union(v.number(), v.null()),
});

export const deepReport = v.object({
  package: v.string(),
  version: v.string(),
  ecosystem,
  depth: v.number(),
  requested_depth: v.number(),
  dependencies: v.number(),
  vulnerable_dependencies: v.number(),
  summary: severityCounts,
  max_severity: v.union(severity, v.null()),
  trust: v.union(v.number(), v.null()),
  lowest_trust: v.union(v.number(), v.null()),
  truncated: v.boolean(),
  unresolved: v.array(unresolvedRequirement),
  packages: v.array(packageTrust),
  vulnerabilities: v.array(finding),
});
