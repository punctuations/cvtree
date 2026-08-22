export interface Pep440Version {
  epoch: number;
  release: number[];
  pre: [string, number] | null;
  post: number | null;
  dev: number | null;
}

const VERSION_PATTERN =
  /^\s*v?(?:(\d+)!)?(\d+(?:\.\d+)*)((?:[-_.]?(?:a|b|c|rc|alpha|beta|pre|preview)[-_.]?\d*)?)((?:[-_.]?(?:post|rev|r)[-_.]?\d*|-\d+)?)((?:[-_.]?dev[-_.]?\d*)?)(?:\+[0-9A-Za-z.]+)?\s*$/i;

const PRE_LABELS: Record<string, string> = {
  a: "a",
  alpha: "a",
  b: "b",
  beta: "b",
  c: "rc",
  rc: "rc",
  pre: "rc",
  preview: "rc",
};

const PRE_RANK: Record<string, number> = { a: 0, b: 1, rc: 2 };

export function parsePep440(input: string): Pep440Version | null {
  const match = VERSION_PATTERN.exec(input);
  if (!match) {
    return null;
  }

  const release = match[2].split(".").map(Number);
  if (release.some((part) => Number.isNaN(part))) {
    return null;
  }

  return {
    epoch: match[1] === undefined ? 0 : Number(match[1]),
    release,
    pre: parsePre(match[3]),
    post: parsePost(match[4]),
    dev: parseDev(match[5]),
  };
}

function parsePre(segment: string): [string, number] | null {
  if (!segment) {
    return null;
  }

  const match = /^[-_.]?([a-z]+)[-_.]?(\d*)$/i.exec(segment);
  if (!match) {
    return null;
  }

  const label = PRE_LABELS[match[1].toLowerCase()];
  return label ? [label, match[2] === "" ? 0 : Number(match[2])] : null;
}

function parsePost(segment: string): number | null {
  if (!segment) {
    return null;
  }

  const implicit = /^-(\d+)$/.exec(segment);
  if (implicit) {
    return Number(implicit[1]);
  }

  const match = /^[-_.]?(?:post|rev|r)[-_.]?(\d*)$/i.exec(segment);
  return match ? (match[1] === "" ? 0 : Number(match[1])) : null;
}

function parseDev(segment: string): number | null {
  if (!segment) {
    return null;
  }

  const match = /^[-_.]?dev[-_.]?(\d*)$/i.exec(segment);
  return match ? (match[1] === "" ? 0 : Number(match[1])) : null;
}

function releaseAt(version: Pep440Version, index: number): number {
  return version.release[index] ?? 0;
}

export function comparePep440(a: Pep440Version, b: Pep440Version): number {
  if (a.epoch !== b.epoch) {
    return a.epoch - b.epoch;
  }

  const length = Math.max(a.release.length, b.release.length);
  for (let index = 0; index < length; index += 1) {
    const order = releaseAt(a, index) - releaseAt(b, index);
    if (order !== 0) {
      return order;
    }
  }

  const preOrder = comparePre(a, b);
  if (preOrder !== 0) {
    return preOrder;
  }

  const postOrder = compareOptional(a.post, b.post, 1);
  if (postOrder !== 0) {
    return postOrder;
  }

  return compareOptional(a.dev, b.dev, -1);
}

function comparePre(a: Pep440Version, b: Pep440Version): number {
  if (a.pre === null && b.pre === null) {
    return 0;
  }
  if (a.pre === null) {
    return a.dev !== null && a.post === null ? -1 : 1;
  }
  if (b.pre === null) {
    return b.dev !== null && b.post === null ? 1 : -1;
  }

  const rank = PRE_RANK[a.pre[0]] - PRE_RANK[b.pre[0]];
  return rank !== 0 ? rank : a.pre[1] - b.pre[1];
}

function compareOptional(a: number | null, b: number | null, presentWins: number): number {
  if (a === null && b === null) return 0;
  if (a === null) return -presentWins;
  if (b === null) return presentWins;
  return a - b;
}

export function isPrerelease(version: Pep440Version): boolean {
  return version.pre !== null || version.dev !== null;
}

interface Specifier {
  operator: string;
  value: string;
}

function parseSpecifiers(input: string): Specifier[] | null {
  const specifiers: Specifier[] = [];

  for (const part of input.split(",")) {
    const term = part.trim();
    if (!term || term === "*") {
      continue;
    }

    const match = /^(===|==|!=|>=|<=|~=|>|<)\s*(.+)$/.exec(term);
    if (!match) {
      return null;
    }
    specifiers.push({ operator: match[1], value: match[2].trim() });
  }

  return specifiers;
}

function prefixMatch(version: string, pattern: string): boolean {
  const parsed = parsePep440(version);
  const target = parsePep440(pattern.slice(0, -2));
  if (!parsed || !target) {
    return false;
  }

  return target.release.every((part, index) => releaseAt(parsed, index) === part);
}

function compatibleBound(value: string): string | null {
  const parsed = parsePep440(value);
  if (!parsed || parsed.release.length < 2) {
    return null;
  }

  const release = parsed.release.slice(0, -1);
  release[release.length - 1] += 1;
  return release.join(".");
}

function matchesSpecifier(version: Pep440Version, specifier: Specifier): boolean {
  if (specifier.operator === "===") {
    return false;
  }

  if (specifier.operator === "==" || specifier.operator === "!=") {
    if (specifier.value.endsWith(".*")) {
      const matched = prefixMatch(formatRelease(version), specifier.value);
      return specifier.operator === "==" ? matched : !matched;
    }
  }

  if (specifier.operator === "~=") {
    const bound = compatibleBound(specifier.value);
    const lower = parsePep440(specifier.value);
    const upper = bound ? parsePep440(bound) : null;
    if (!lower || !upper) {
      return false;
    }
    return comparePep440(version, lower) >= 0 && comparePep440(version, upper) < 0;
  }

  const target = parsePep440(specifier.value);
  if (!target) {
    return false;
  }

  const order = comparePep440(version, target);
  switch (specifier.operator) {
    case "==":
      return order === 0;
    case "!=":
      return order !== 0;
    case ">=":
      return order >= 0;
    case "<=":
      return order <= 0;
    case ">":
      return order > 0;
    case "<":
      return order < 0;
    default:
      return false;
  }
}

function formatRelease(version: Pep440Version): string {
  return version.release.join(".");
}

export function satisfiesPep440(version: Pep440Version, specifierSet: string): boolean {
  const specifiers = parseSpecifiers(specifierSet);
  if (specifiers === null) {
    return false;
  }

  return specifiers.every((specifier) => matchesSpecifier(version, specifier));
}

export function maxSatisfyingPep440(versions: string[], specifierSet: string): string | null {
  let best: { raw: string; parsed: Pep440Version } | null = null;
  let fallback: { raw: string; parsed: Pep440Version } | null = null;

  for (const raw of versions) {
    const parsed = parsePep440(raw);
    if (!parsed || !satisfiesPep440(parsed, specifierSet)) {
      continue;
    }

    const slot = isPrerelease(parsed) ? "fallback" : "best";
    const current = slot === "best" ? best : fallback;

    if (!current || comparePep440(parsed, current.parsed) > 0) {
      if (slot === "best") {
        best = { raw, parsed };
      } else {
        fallback = { raw, parsed };
      }
    }
  }

  return (best ?? fallback)?.raw ?? null;
}

export interface Requirement {
  name: string;
  specifier: string;
  extras: string[];
  marker: string | null;
}

export function parseRequirement(input: string): Requirement | null {
  const [head, ...markerParts] = input.split(";");
  const marker = markerParts.length > 0 ? markerParts.join(";").trim() : null;

  const match = /^\s*([A-Za-z0-9._-]+)\s*(?:\[([^\]]*)\])?\s*(.*)$/.exec(head);
  if (!match) {
    return null;
  }

  const specifier = match[3].trim().replace(/^\(/, "").replace(/\)$/, "").trim();

  return {
    name: match[1],
    specifier,
    extras: match[2] ? match[2].split(",").map((extra) => extra.trim()) : [],
    marker,
  };
}

export function requiredWithoutExtras(requirement: Requirement): boolean {
  return requirement.marker === null || !/\bextra\b/.test(requirement.marker);
}
