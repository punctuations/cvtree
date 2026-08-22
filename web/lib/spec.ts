import { CACHE_SCHEMA_VERSION } from "@/convex/cache";

import type { Ecosystem } from "./model";

export interface PackageQuery {
  kind: "package";
  ecosystem: Ecosystem | null;
  name: string;
  version: string | null;
}

export interface RepoQuery {
  kind: "repo";
  owner: string;
  name: string;
}

export type Query = PackageQuery | RepoQuery;

export type ParseResult = { ok: true; query: Query } | { ok: false; message: string };

const ECOSYSTEM_ALIASES: Record<string, Ecosystem> = {
  npm: "npm",
  node: "npm",
  javascript: "npm",
  cargo: "crates.io",
  crates: "crates.io",
  "crates.io": "crates.io",
  rust: "crates.io",
  pip: "PyPI",
  pypi: "PyPI",
  python: "PyPI",
};

export function parseEcosystem(value: string): Ecosystem | null {
  return ECOSYSTEM_ALIASES[value.toLowerCase()] ?? null;
}

export function unknownEcosystem(value: string): string {
  return `unknown ecosystem '${value}' (supported: npm, crates.io, PyPI)`;
}

const REPO_PREFIXES = new Set(["github", "gh", "repo"]);
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

function repoQuery(owner: string, name: string): RepoQuery {
  return { kind: "repo", owner, name: name.replace(/\.git$/, "") };
}

function looksLikeRepo(owner: string, name: string): boolean {
  const bare = name.replace(/\.git$/, "");
  return OWNER.test(owner) && REPO.test(bare) && bare !== "." && bare !== "..";
}

export function parseRepo(input: string): RepoQuery | null {
  let rest = input.trim();

  const url = rest.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i);
  if (url) {
    rest = url[1];
  }

  const segments = rest.split("/").filter((segment) => segment.length > 0);
  if (segments.length !== 2) {
    return null;
  }

  const [owner, name] = segments;
  return looksLikeRepo(owner, name) ? repoQuery(owner, name) : null;
}

export function parseQuery(input: string): ParseResult {
  const trimmed = input.trim();

  if (!trimmed) {
    return { ok: false, message: "expected a package such as lodash@4.17.15" };
  }

  let ecosystem: Ecosystem | null = null;
  let rest = trimmed;

  const colon = trimmed.indexOf(":");
  if (colon > 0 && !trimmed.startsWith("@")) {
    const prefix = trimmed.slice(0, colon);

    if (REPO_PREFIXES.has(prefix.toLowerCase())) {
      const repo = parseRepo(trimmed.slice(colon + 1));
      return repo
        ? { ok: true, query: repo }
        : { ok: false, message: `'${trimmed}' is not a github repository such as facebook/react` };
    }

    if (prefix.toLowerCase() === "https" || prefix.toLowerCase() === "http") {
      const repo = parseRepo(trimmed);
      return repo
        ? { ok: true, query: repo }
        : { ok: false, message: `'${trimmed}' is not a github repository such as facebook/react` };
    }

    ecosystem = parseEcosystem(prefix);
    if (!ecosystem) {
      return { ok: false, message: unknownEcosystem(prefix) };
    }
    rest = trimmed.slice(colon + 1);
  }

  if (!ecosystem && !trimmed.startsWith("@") && !trimmed.includes("@")) {
    const repo = parseRepo(trimmed);
    if (repo) {
      return { ok: true, query: repo };
    }
  }

  const at = rest.lastIndexOf("@");
  const name = at > 0 ? rest.slice(0, at) : rest;
  const version = at > 0 ? rest.slice(at + 1) : null;

  if (!name) {
    return { ok: false, message: `'${trimmed}' is missing a package name` };
  }
  if (version === "") {
    return { ok: false, message: `'${trimmed}' is missing a version after '@'` };
  }

  return { ok: true, query: { kind: "package", ecosystem, name, version } };
}

export { CACHE_SCHEMA_VERSION };

export function cacheKey(ecosystem: string, name: string, version: string): string {
  return `v${CACHE_SCHEMA_VERSION}:${ecosystem}/${name}/${version}`;
}

export function deepCacheKey(
  ecosystem: string,
  name: string,
  version: string,
  depth: number,
): string {
  return `v${CACHE_SCHEMA_VERSION}:deep:${ecosystem}/${name}/${version}:d${depth}`;
}
