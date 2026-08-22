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
  type UnresolvedRequirement,
  type Vulnerability,
} from "./model";
import { queryOsvBatch } from "./osv/client";
import { mapWithConcurrency } from "./pool";
import { latestVersion } from "./registry";

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
  const results = await queryOsvBatch(all.map((node) => node.dependency));

  return assemble(root, all, results, {
    depth: reached,
    requestedDepth,
    truncated,
    unresolved,
  });
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
  meta: Meta,
): DeepReport {
  const summary = emptyCounts();
  const findings: Finding[] = [];
  let vulnerable = 0;

  for (let index = 0; index < nodes.length; index += 1) {
    const found = results[index] ?? [];
    if (found.length === 0) {
      continue;
    }

    vulnerable += 1;

    for (const vulnerability of found) {
      recordSeverity(summary, vulnerability.severity);
      findings.push(toFinding(vulnerability, nodes[index].path));
    }
  }

  findings.sort(bySeverityThenPackage);

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
    truncated: meta.truncated,
    unresolved: meta.unresolved,
    vulnerabilities: findings,
  };
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
