export type Ecosystem = "npm" | "crates.io";

export interface PackageQuery {
  ecosystem: Ecosystem;
  name: string;
  version: string | null;
}

const ECOSYSTEM_ALIASES: Record<string, Ecosystem> = {
  npm: "npm",
  node: "npm",
  javascript: "npm",
  cargo: "crates.io",
  crates: "crates.io",
  "crates.io": "crates.io",
  rust: "crates.io",
};

export function parseQuery(input: string): PackageQuery | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  let ecosystem: Ecosystem = "npm";
  let rest = trimmed;

  const colon = trimmed.indexOf(":");
  if (colon > 0 && !trimmed.startsWith("@")) {
    const alias = ECOSYSTEM_ALIASES[trimmed.slice(0, colon).toLowerCase()];
    if (!alias) {
      return null;
    }
    ecosystem = alias;
    rest = trimmed.slice(colon + 1);
  }

  const at = rest.lastIndexOf("@");
  const name = at > 0 ? rest.slice(0, at) : rest;
  const version = at > 0 ? rest.slice(at + 1) : null;

  if (!name || version === "") {
    return null;
  }

  return { ecosystem, name, version };
}

export function cacheKey(ecosystem: string, name: string, version: string): string {
  return `${ecosystem}/${name}/${version}`;
}
