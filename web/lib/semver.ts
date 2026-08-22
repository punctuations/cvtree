export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: (string | number)[];
}

const VERSION_PATTERN =
  /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseSemVer(input: string): SemVer | null {
  const match = VERSION_PATTERN.exec(input.trim());
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: match[2] === undefined ? 0 : Number(match[2]),
    patch: match[3] === undefined ? 0 : Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split(".").map(identifier),
  };
}

function identifier(part: string): string | number {
  return /^\d+$/.test(part) ? Number(part) : part;
}

export function compareSemVer(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;

  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;

  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const left = a.prerelease[index];
    const right = b.prerelease[index];

    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;

    if (typeof left === "number" && typeof right === "number") return left - right;
    if (typeof left === "number") return -1;
    if (typeof right === "number") return 1;
    return left < right ? -1 : 1;
  }

  return 0;
}

interface Comparator {
  operator: ">=" | ">" | "<=" | "<" | "=";
  version: SemVer;
}

interface Partial {
  major: number;
  minor?: number;
  patch?: number;
  prerelease: (string | number)[];
}

const OPERATOR_PATTERN = /^(>=|<=|>|<|=|\^|~>|~)?\s*(.*)$/;
const PARTIAL_PATTERN =
  /^(\d+|\*|x|X)(?:\.(\d+|\*|x|X))?(?:\.(\d+|\*|x|X))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function wildcard(part: string | undefined): boolean {
  return part === undefined || part === "" || part === "*" || part === "x" || part === "X";
}

function parsePartial(input: string): Partial | null {
  const match = PARTIAL_PATTERN.exec(input.trim().replace(/^v/, ""));
  if (!match) {
    return null;
  }

  if (wildcard(match[1])) {
    return { major: -1, prerelease: [] };
  }

  return {
    major: Number(match[1]),
    minor: wildcard(match[2]) ? undefined : Number(match[2]),
    patch: wildcard(match[3]) ? undefined : Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split(".").map(identifier),
  };
}

function fill(partial: Partial): SemVer {
  return {
    major: partial.major,
    minor: partial.minor ?? 0,
    patch: partial.patch ?? 0,
    prerelease: partial.prerelease,
  };
}

function wildcardBound(partial: Partial): SemVer | null {
  if (partial.minor === undefined) {
    return { major: partial.major + 1, minor: 0, patch: 0, prerelease: [] };
  }
  if (partial.patch === undefined) {
    return { major: partial.major, minor: partial.minor + 1, patch: 0, prerelease: [] };
  }
  return null;
}

function caretBound(partial: Partial): SemVer {
  if (partial.major > 0 || partial.minor === undefined) {
    return { major: partial.major + 1, minor: 0, patch: 0, prerelease: [] };
  }
  if (partial.minor > 0 || partial.patch === undefined) {
    return { major: 0, minor: partial.minor + 1, patch: 0, prerelease: [] };
  }
  return { major: 0, minor: partial.minor, patch: partial.patch + 1, prerelease: [] };
}

function tildeBound(partial: Partial): SemVer {
  if (partial.minor === undefined) {
    return { major: partial.major + 1, minor: 0, patch: 0, prerelease: [] };
  }
  return { major: partial.major, minor: partial.minor + 1, patch: 0, prerelease: [] };
}

function comparators(term: string, caretDefault: boolean): Comparator[] | null {
  const match = OPERATOR_PATTERN.exec(term.trim());
  if (!match) {
    return null;
  }

  const operator = match[1];
  const rest = match[2].trim();

  if (wildcard(rest)) {
    return [];
  }

  const partial = parsePartial(rest);
  if (!partial) {
    return null;
  }
  if (partial.major < 0) {
    return [];
  }

  const lower = fill(partial);

  switch (operator) {
    case ">=":
      return [{ operator: ">=", version: lower }];
    case ">":
      return [{ operator: ">", version: lower }];
    case "<=":
      return [{ operator: "<=", version: lower }];
    case "<":
      return [{ operator: "<", version: lower }];
    case "^":
      return [
        { operator: ">=", version: lower },
        { operator: "<", version: caretBound(partial) },
      ];
    case "~":
    case "~>":
      return [
        { operator: ">=", version: lower },
        { operator: "<", version: tildeBound(partial) },
      ];
    default:
      break;
  }

  const bound = wildcardBound(partial);
  if (bound) {
    return [
      { operator: ">=", version: lower },
      { operator: "<", version: bound },
    ];
  }

  if (operator === undefined && caretDefault) {
    return [
      { operator: ">=", version: lower },
      { operator: "<", version: caretBound(partial) },
    ];
  }

  return [{ operator: "=", version: lower }];
}

function hyphen(term: string): Comparator[] | null {
  const parts = term.split(/\s+-\s+/);
  if (parts.length !== 2) {
    return null;
  }

  const low = parsePartial(parts[0]);
  const high = parsePartial(parts[1]);
  if (!low || !high || low.major < 0 || high.major < 0) {
    return null;
  }

  const bound = wildcardBound(high);
  return [
    { operator: ">=", version: fill(low) },
    bound ? { operator: "<", version: bound } : { operator: "<=", version: fill(high) },
  ];
}

function parseSet(input: string, caretDefault: boolean): Comparator[] | null {
  const range = hyphen(input);
  if (range) {
    return range;
  }

  const terms = input
    .replace(/([<>=~^]+)\s+/g, "$1")
    .split(/[\s,]+/)
    .filter((term) => term.length > 0);

  const parsed: Comparator[] = [];
  for (const term of terms) {
    const result = comparators(term, caretDefault);
    if (result === null) {
      return null;
    }
    parsed.push(...result);
  }

  return parsed;
}

function matchesSet(version: SemVer, set: Comparator[]): boolean {
  if (version.prerelease.length > 0) {
    const allowed = set.some(
      (comparator) =>
        comparator.version.prerelease.length > 0 &&
        comparator.version.major === version.major &&
        comparator.version.minor === version.minor &&
        comparator.version.patch === version.patch,
    );
    if (!allowed) {
      return false;
    }
  }

  return set.every((comparator) => {
    const order = compareSemVer(version, comparator.version);
    switch (comparator.operator) {
      case ">=":
        return order >= 0;
      case ">":
        return order > 0;
      case "<=":
        return order <= 0;
      case "<":
        return order < 0;
      case "=":
        return order === 0;
    }
  });
}

export function satisfies(version: SemVer, range: string, caretDefault: boolean): boolean {
  for (const set of range.split("||")) {
    const parsed = parseSet(set, caretDefault);
    if (parsed !== null && matchesSet(version, parsed)) {
      return true;
    }
  }

  return false;
}

export function maxSatisfying(
  versions: string[],
  range: string,
  caretDefault: boolean,
): string | null {
  let best: { raw: string; parsed: SemVer } | null = null;

  for (const raw of versions) {
    const parsed = parseSemVer(raw);
    if (!parsed || !satisfies(parsed, range, caretDefault)) {
      continue;
    }
    if (!best || compareSemVer(parsed, best.parsed) > 0) {
      best = { raw, parsed };
    }
  }

  return best?.raw ?? null;
}
