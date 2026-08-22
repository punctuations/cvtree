import { CvtreeError } from "./errors";
import type { Ecosystem } from "./model";
import { maxSatisfyingPep440, parseRequirement, requiredWithoutExtras } from "./pep440";
import { maxSatisfying } from "./semver";

const NPM_BASE_URL = process.env.NPM_REGISTRY_URL ?? "https://registry.npmjs.org";
const CRATES_BASE_URL = process.env.CRATES_REGISTRY_URL ?? "https://crates.io/api/v1";
const PYPI_BASE_URL = process.env.PYPI_REGISTRY_URL ?? "https://pypi.org/pypi";
const USER_AGENT = "cvtree-web/0.1.0";
const REQUEST_TIMEOUT_MS = 15000;

export interface Requirement {
  name: string;
  range: string;
}

export interface ResolvedRequirement {
  name: string;
  range: string;
  version: string | null;
  reason?: string;
}

async function getJson(url: string, accept: string): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch(url, {
      headers: { accept, "user-agent": USER_AGENT },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new CvtreeError(`registry request to ${url} failed`, 502);
  }

  if (response.status === 404) {
    throw new CvtreeError("package not found", 404);
  }
  if (!response.ok) {
    throw new CvtreeError(`registry returned HTTP ${response.status}`, 502);
  }

  try {
    return await response.json();
  } catch {
    throw new CvtreeError("the registry returned a malformed response", 502);
  }
}

interface NpmVersion {
  dependencies?: Record<string, string>;
}

interface NpmPackument {
  versions?: Record<string, NpmVersion>;
}

interface CratesVersion {
  num?: string;
  yanked?: boolean;
}

interface CratesDependency {
  crate_id?: string;
  req?: string;
  kind?: string;
  optional?: boolean;
}

interface PypiRelease {
  info?: { version?: string; requires_dist?: string[] | null };
  releases?: Record<string, unknown[]>;
}

export class Registry {
  private readonly documents = new Map<string, Promise<unknown>>();
  private readonly requirements = new Map<string, Promise<Requirement[]>>();

  private document(url: string, accept: string): Promise<unknown> {
    const existing = this.documents.get(url);
    if (existing) {
      return existing;
    }

    const pending = getJson(url, accept);
    this.documents.set(url, pending);
    return pending;
  }

  async versions(name: string, ecosystem: Ecosystem): Promise<string[]> {
    switch (ecosystem) {
      case "npm": {
        const body = (await this.npmPackument(name)) as NpmPackument;
        return Object.keys(body.versions ?? {});
      }
      case "crates.io": {
        const body = (await this.document(
          `${CRATES_BASE_URL}/crates/${encodeURIComponent(name)}`,
          "application/json",
        )) as { versions?: CratesVersion[] };
        return (body.versions ?? [])
          .filter((entry) => !entry.yanked && typeof entry.num === "string")
          .map((entry) => entry.num as string);
      }
      case "PyPI": {
        const body = (await this.document(
          `${PYPI_BASE_URL}/${encodeURIComponent(name)}/json`,
          "application/json",
        )) as PypiRelease;
        return Object.keys(body.releases ?? {});
      }
    }
  }

  private npmPackument(name: string): Promise<unknown> {
    return this.document(
      `${NPM_BASE_URL}/${npmPath(name)}`,
      "application/vnd.npm.install-v1+json, application/json",
    );
  }

  async resolve(name: string, range: string, ecosystem: Ecosystem): Promise<string | null> {
    const available = await this.versions(name, ecosystem);

    switch (ecosystem) {
      case "npm":
        return maxSatisfying(available, normalizeNpmRange(range), false);
      case "crates.io":
        return maxSatisfying(available, range, true);
      case "PyPI":
        return maxSatisfyingPep440(available, range);
    }
  }

  requirementsOf(name: string, version: string, ecosystem: Ecosystem): Promise<Requirement[]> {
    const key = `${ecosystem}/${name}/${version}`;
    const existing = this.requirements.get(key);
    if (existing) {
      return existing;
    }

    const pending = this.loadRequirements(name, version, ecosystem);
    this.requirements.set(key, pending);
    return pending;
  }

  private async loadRequirements(
    name: string,
    version: string,
    ecosystem: Ecosystem,
  ): Promise<Requirement[]> {
    switch (ecosystem) {
      case "npm": {
        const body = (await this.npmPackument(name)) as NpmPackument;
        const entry = body.versions?.[version];
        if (!entry) {
          throw new CvtreeError(`npm has no published ${name}@${version}`, 404);
        }
        return Object.entries(entry.dependencies ?? {})
          .filter(([, range]) => isPlainNpmRange(range))
          .map(([dependency, range]) => ({ name: dependency, range }));
      }
      case "crates.io": {
        const body = (await this.document(
          `${CRATES_BASE_URL}/crates/${encodeURIComponent(name)}/${encodeURIComponent(version)}/dependencies`,
          "application/json",
        )) as { dependencies?: CratesDependency[] };
        return (body.dependencies ?? [])
          .filter((entry) => entry.kind === "normal" && !entry.optional && entry.crate_id)
          .map((entry) => ({ name: entry.crate_id as string, range: entry.req ?? "*" }));
      }
      case "PyPI": {
        const body = (await this.document(
          `${PYPI_BASE_URL}/${encodeURIComponent(name)}/${encodeURIComponent(version)}/json`,
          "application/json",
        )) as PypiRelease;

        const requirements: Requirement[] = [];
        for (const line of body.info?.requires_dist ?? []) {
          const parsed = parseRequirement(line);
          if (parsed && requiredWithoutExtras(parsed)) {
            requirements.push({ name: parsed.name, range: parsed.specifier || "*" });
          }
        }
        return requirements;
      }
    }
  }

  async children(
    name: string,
    version: string,
    ecosystem: Ecosystem,
  ): Promise<ResolvedRequirement[]> {
    const requirements = await this.requirementsOf(name, version, ecosystem);

    const resolved = await Promise.all(
      requirements.map(async (requirement) => {
        try {
          const match = await this.resolve(requirement.name, requirement.range, ecosystem);
          return match
            ? { ...requirement, version: match }
            : { ...requirement, version: null, reason: "no published version satisfies the range" };
        } catch (error) {
          const reason =
            error instanceof CvtreeError ? error.message : "the registry could not be reached";
          return { ...requirement, version: null, reason };
        }
      }),
    );

    return resolved;
  }
}

function npmPath(name: string): string {
  return name.startsWith("@")
    ? `${encodeURIComponent(name.slice(0, name.indexOf("/")))}/${encodeURIComponent(name.slice(name.indexOf("/") + 1))}`
    : encodeURIComponent(name);
}

function normalizeNpmRange(range: string): string {
  const trimmed = range.trim();
  return trimmed === "" || trimmed === "latest" || trimmed === "*" ? "*" : trimmed;
}

function isPlainNpmRange(range: string): boolean {
  return !/^(npm:|git|github:|file:|link:|workspace:|https?:)/i.test(range.trim());
}
