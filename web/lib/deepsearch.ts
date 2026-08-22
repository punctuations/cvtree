import { Registry } from "./deps";
import {
  SEVERITY_RANK,
  coordinate,
  emptyCounts,
  highestSeverity,
  recordSeverity,
  type DeepReport,
  type Dependency,
  type Ecosystem,
  type Finding,
  type PackageTrust,
  type UnresolvedRequirement,
  type Vulnerability,
} from "./model";
import { countOsvBatch, queryOsvBatch } from "./osv/client";
import { mapWithConcurrency } from "./pool";
import { latestVersion } from "./registry";
import { trustScore } from "./trust";

export const DEFAULT_DEPTH = 2;
export const MAX_DEPTH = 6;
export const MAX_NODES = 400;

const REGISTRY_CONCURRENCY = 8;

export interface DeepOptions {
  depth?: number;
  maxNodes?: number;
}

interface Node {
  dependency: Dependency;
  depth: number;
  path: string[];
}

export function clampDepth(requested: number | null): number {
  if (requested === null || Number.isNaN(requested)) {
    return DEFAULT_DEPTH;
  }
  return Math.min(Math.max(Math.trunc(requested), 0), MAX_DEPTH);
}

export async function deepReport(
  name: string,
  version: string | null,
  ecosystem: Ecosystem,
  options: DeepOptions = {},
): Promise<DeepReport> {
  const requestedDepth = clampDepth(options.depth ?? DEFAULT_DEPTH);
  const maxNodes = options.maxNodes ?? MAX_NODES;
  const registry = new Registry();

  const resolved = version ?? (await latestVersion(name, ecosystem));
  const root: Dependency = { name, version: resolved, ecosystem };

  const nodes = new Map<string, Node>();
  const unresolved: UnresolvedRequirement[] = [];
  let truncated = false;
  let reached = 0;

  const rootNode: Node = { dependency: root, depth: 0, path: [coordinate(root)] };
  nodes.set(coordinate(root), rootNode);

  if (requestedDepth > 0) {
    await registry.requirementsOf(name, resolved, ecosystem);
  }

  let frontier = [rootNode];

  for (let depth = 1; depth <= requestedDepth && frontier.length > 0; depth += 1) {
    const expanded = await mapWithConcurrency(frontier, REGISTRY_CONCURRENCY, async (node) => {
      const { name: parentName, version: parentVersion, ecosystem: parentEcosystem } =
        node.dependency;
      try {
        return await registry.children(parentName, parentVersion, parentEcosystem);
      } catch {
        return [];
      }
    });

    const next: Node[] = [];

    for (let index = 0; index < frontier.length; index += 1) {
      const parent = frontier[index];

      for (const child of expanded[index]) {
        if (child.version === null) {
          unresolved.push({
            name: child.name,
            range: child.range,
            parent: coordinate(parent.dependency),
            reason: child.reason ?? "unresolved",
          });
          continue;
        }

        const dependency: Dependency = {
          name: child.name,
          version: child.version,
          ecosystem,
        };
        const key = coordinate(dependency);

        if (nodes.has(key)) {
          continue;
        }
        if (nodes.size >= maxNodes) {
          truncated = true;
          break;
        }

        const node: Node = {
          dependency,
          depth,
          path: [...parent.path, key],
        };
        nodes.set(key, node);
        next.push(node);
        reached = depth;
      }

      if (truncated) {
        break;
      }
    }

    if (truncated) {
      break;
    }

    frontier = next;
  }

  const all = [...nodes.values()];

  const [results, history] = await Promise.all([
    queryOsvBatch(all.map((node) => node.dependency)),
    trackRecords(registry, all),
  ]);

  return assemble(root, all, results, history, {
    depth: reached,
    requestedDepth,
    truncated,
    unresolved,
  });
}

interface TrackRecord {
  advisories: number;
  versions: number;
}

async function trackRecords(registry: Registry, nodes: Node[]): Promise<TrackRecord[]> {
  const [advisories, versions] = await Promise.all([
    countOsvBatch(
      nodes.map((node) => ({
        name: node.dependency.name,
        ecosystem: node.dependency.ecosystem,
      })),
    ).catch(() => nodes.map(() => 0)),
    mapWithConcurrency(nodes, REGISTRY_CONCURRENCY, async (node) => {
      try {
        const published = await registry.versions(
          node.dependency.name,
          node.dependency.ecosystem,
        );
        return published.length;
      } catch {
        return 0;
      }
    }),
  ]);

  return nodes.map((_, index) => ({
    advisories: advisories[index] ?? 0,
    versions: versions[index] ?? 0,
  }));
}

interface Meta {
  depth: number;
  requestedDepth: number;
  truncated: boolean;
  unresolved: UnresolvedRequirement[];
}

function assemble(
  root: Dependency,
  nodes: Node[],
  results: Vulnerability[][],
  history: TrackRecord[],
  meta: Meta,
): DeepReport {
  const summary = emptyCounts();
  const findings: Finding[] = [];
  const packages: PackageTrust[] = [];
  let vulnerable = 0;

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const found = results[index] ?? [];
    const record = history[index] ?? { advisories: 0, versions: 0 };

    packages.push({
      name: node.dependency.name,
      version: node.dependency.version,
      ecosystem: node.dependency.ecosystem,
      depth: node.depth,
      path: node.path,
      advisories: record.advisories,
      versions: record.versions,
      vulnerability_count: found.length,
      trust: trustScore(record.advisories, record.versions),
    });

    if (found.length === 0) {
      continue;
    }

    vulnerable += 1;

    for (const vulnerability of found) {
      recordSeverity(summary, vulnerability.severity);
      findings.push(toFinding(vulnerability, node.path));
    }
  }

  findings.sort(bySeverityThenPackage);
  packages.sort(byTrustThenName);

  const rated = packages
    .map((entry) => entry.trust)
    .filter((score): score is number => score !== null);

  return {
    package: root.name,
    version: root.version,
    ecosystem: root.ecosystem,
    depth: meta.depth,
    requested_depth: meta.requestedDepth,
    dependencies: nodes.length,
    vulnerable_dependencies: vulnerable,
    summary,
    max_severity: highestSeverity(findings.map((finding) => finding.severity)),
    trust: packages.find((entry) => entry.depth === 0)?.trust ?? null,
    lowest_trust: rated.length > 0 ? Math.min(...rated) : null,
    truncated: meta.truncated,
    unresolved: meta.unresolved,
    packages,
    vulnerabilities: findings,
  };
}

function byTrustThenName(a: PackageTrust, b: PackageTrust): number {
  const left = a.trust ?? Number.POSITIVE_INFINITY;
  const right = b.trust ?? Number.POSITIVE_INFINITY;
  return left - right || a.name.localeCompare(b.name);
}

function toFinding(vulnerability: Vulnerability, path: string[]): Finding {
  return {
    package: vulnerability.package.name,
    version: vulnerability.package.version,
    ecosystem: vulnerability.package.ecosystem,
    id: vulnerability.id,
    aliases: vulnerability.aliases,
    severity: vulnerability.severity ?? null,
    cvss_score: vulnerability.cvss_score,
    summary: vulnerability.summary,
    fixed_versions: vulnerability.fixed_versions,
    affected: vulnerability.affected,
    references: vulnerability.references,
    path,
  };
}

function rank(finding: Finding): number {
  return finding.severity ? SEVERITY_RANK[finding.severity] : 0;
}

function bySeverityThenPackage(a: Finding, b: Finding): number {
  return rank(b) - rank(a) || a.package.localeCompare(b.package) || a.id.localeCompare(b.id);
}
