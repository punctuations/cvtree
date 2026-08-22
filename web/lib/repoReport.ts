import { GithubUnavailable, repoAdvisories, repoExists } from "./github/client";
import { normalizeAdvisory } from "./github/normalize";
import { CvtreeError } from "./errors";
import {
  highestSeverity,
  SEVERITY_RANK,
  type AdvisorySource,
  type RepoAdvisory,
  type RepoReport,
  type Severity,
  type SourceStatus,
} from "./model";
import { queryOsvRepo } from "./osv/client";
import { normalizeRepoAdvisory } from "./osv/normalize";

export function repoUrl(owner: string, name: string): string {
  return `https://github.com/${owner}/${name}`;
}

export async function repoReport(owner: string, name: string): Promise<RepoReport> {
  const url = repoUrl(owner, name);

  const [osv, github] = await Promise.all([collectOsv(url), collectGithub(owner, name)]);

  if (!osv.status.ok && !github.status.ok) {
    throw new CvtreeError(
      `could not reach either advisory source for ${owner}/${name}: ${osv.status.message}`,
      502,
    );
  }

  if (osv.advisories.length === 0 && github.advisories.length === 0) {
    await confirmRepo(owner, name);
  }

  const advisories = merge([...github.advisories, ...osv.advisories]);

  return {
    repo: `${owner}/${name}`,
    owner,
    name,
    url,
    advisory_count: advisories.length,
    max_severity: highestSeverity(advisories.map((advisory) => advisory.severity)),
    sources: [osv.status, github.status],
    advisories,
  };
}

async function confirmRepo(owner: string, name: string): Promise<void> {
  try {
    await repoExists(owner, name);
  } catch (error) {
    if (error instanceof CvtreeError) {
      throw error;
    }
  }
}

interface Collected {
  advisories: RepoAdvisory[];
  status: SourceStatus;
}

async function collectOsv(url: string): Promise<Collected> {
  try {
    const raw = await queryOsvRepo(url);
    const advisories = raw
      .filter((item) => !item.withdrawn)
      .map((item) => normalizeRepoAdvisory(item));

    return { advisories, status: source("OSV", true, advisories.length) };
  } catch (error) {
    return {
      advisories: [],
      status: source("OSV", false, 0, message(error)),
    };
  }
}

async function collectGithub(owner: string, name: string): Promise<Collected> {
  try {
    const raw = await repoAdvisories(owner, name);
    const advisories = raw
      .filter((item) => !item.withdrawn_at)
      .map((item) => normalizeAdvisory(item));

    return { advisories, status: source("GitHub", true, advisories.length) };
  } catch (error) {
    if (error instanceof CvtreeError) {
      throw error;
    }
    return {
      advisories: [],
      status: source("GitHub", false, 0, message(error)),
    };
  }
}

function source(
  name: AdvisorySource,
  ok: boolean,
  count: number,
  message?: string,
): SourceStatus {
  return message ? { name, ok, count, message } : { name, ok, count };
}

function message(error: unknown): string {
  if (error instanceof GithubUnavailable || error instanceof Error) {
    return error.message;
  }
  return "unavailable";
}

function merge(advisories: RepoAdvisory[]): RepoAdvisory[] {
  const byKey = new Map<string, RepoAdvisory>();

  for (const advisory of advisories) {
    const key = identity(advisory, byKey);
    const existing = byKey.get(key);

    if (existing) {
      byKey.set(key, combine(existing, advisory));
    } else {
      byKey.set(key, advisory);
    }
  }

  return [...byKey.values()].sort(
    (a, b) => rank(b.severity) - rank(a.severity) || a.id.localeCompare(b.id),
  );
}

function identity(advisory: RepoAdvisory, seen: Map<string, RepoAdvisory>): string {
  if (seen.has(advisory.id)) {
    return advisory.id;
  }

  for (const alias of advisory.aliases ?? []) {
    if (seen.has(alias)) {
      return alias;
    }
  }

  for (const [key, existing] of seen) {
    if ((existing.aliases ?? []).includes(advisory.id)) {
      return key;
    }
  }

  return advisory.id;
}

function combine(a: RepoAdvisory, b: RepoAdvisory): RepoAdvisory {
  const sources = [...new Set([...a.sources, ...b.sources])];
  const aliases = [...new Set([...(a.aliases ?? []), ...(b.aliases ?? []), b.id])].filter(
    (alias) => alias !== a.id,
  );

  return {
    ...a,
    sources,
    aliases: aliases.length > 0 ? aliases : undefined,
    summary: a.summary ?? b.summary,
    details: a.details ?? b.details,
    severity: a.severity ?? b.severity,
    cvss_score: a.cvss_score ?? b.cvss_score,
    cvss_vector: a.cvss_vector ?? b.cvss_vector,
    affected: a.affected ?? b.affected,
    fixed_versions: a.fixed_versions ?? b.fixed_versions,
    affected_packages: a.affected_packages ?? b.affected_packages,
    references: mergeReferences(a, b),
    published: a.published ?? b.published,
    modified: a.modified ?? b.modified,
  };
}

function mergeReferences(a: RepoAdvisory, b: RepoAdvisory) {
  const references = [...(a.references ?? [])];

  for (const reference of b.references ?? []) {
    if (!references.some((existing) => existing.url === reference.url)) {
      references.push(reference);
    }
  }

  return references.length > 0 ? references : undefined;
}

function rank(severity: Severity | null | undefined): number {
  return severity ? SEVERITY_RANK[severity] : 0;
}
