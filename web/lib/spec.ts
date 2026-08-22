import type { Ecosystem } from "./model";

export interface PackageQuery {
  ecosystem: Ecosystem | null;
  name: string;
  version: string | null;
}

export type ParseResult =
  | { ok: true; query: PackageQuery }
  | { ok: false; message: string };

const ECOSYSTEM_ALIASES: Record<string, Ecosystem> = {
  npm: "npm",
  node: "npm",
  javascript: "npm",
  cargo: "crates.io",
  crates: "crates.io",
  "crates.io": "crates.io",
  rust: "crates.io",
};

export function parseEcosystem(value: string): Ecosystem | null {
  return ECOSYSTEM_ALIASES[value.toLowerCase()] ?? null;
}

export function unknownEcosystem(value: string): string {
  return `unknown ecosystem '${value}' (supported: npm, crates.io)`;
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
    ecosystem = parseEcosystem(prefix);
    if (!ecosystem) {
      return { ok: false, message: unknownEcosystem(prefix) };
    }
    rest = trimmed.slice(colon + 1);
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

  return { ok: true, query: { ecosystem, name, version } };
}

export function cacheKey(ecosystem: string, name: string, version: string): string {
  return `${ecosystem}/${name}/${version}`;
}
