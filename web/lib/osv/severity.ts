import type { Severity } from "@/lib/model";

const ATTACK_VECTOR: Record<string, number> = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
const ATTACK_COMPLEXITY: Record<string, number> = { L: 0.77, H: 0.44 };
const USER_INTERACTION: Record<string, number> = { N: 0.85, R: 0.62 };
const IMPACT: Record<string, number> = { H: 0.56, L: 0.22, N: 0 };

const PRIVILEGES_UNCHANGED: Record<string, number> = { N: 0.85, L: 0.62, H: 0.27 };
const PRIVILEGES_CHANGED: Record<string, number> = { N: 0.85, L: 0.68, H: 0.5 };

export function severityFromScore(score: number): Severity | null {
  if (score >= 9.0) return "CRITICAL";
  if (score >= 7.0) return "HIGH";
  if (score >= 4.0) return "MEDIUM";
  if (score > 0.0) return "LOW";
  return null;
}

export function severityFromLabel(label: string): Severity | null {
  switch (label.toLowerCase()) {
    case "low":
      return "LOW";
    case "medium":
    case "moderate":
      return "MEDIUM";
    case "high":
      return "HIGH";
    case "critical":
      return "CRITICAL";
    default:
      return null;
  }
}

export function cvssV3BaseScore(vector: string): number | null {
  if (!vector.startsWith("CVSS:3")) {
    return null;
  }

  const metrics = new Map<string, string>();
  for (const part of vector.split("/")) {
    const separator = part.indexOf(":");
    if (separator > 0) {
      metrics.set(part.slice(0, separator), part.slice(separator + 1));
    }
  }

  const scope = metrics.get("S");
  if (scope !== "U" && scope !== "C") {
    return null;
  }
  const scopeChanged = scope === "C";

  const attackVector = ATTACK_VECTOR[metrics.get("AV") ?? ""];
  const attackComplexity = ATTACK_COMPLEXITY[metrics.get("AC") ?? ""];
  const userInteraction = USER_INTERACTION[metrics.get("UI") ?? ""];
  const privileges = (scopeChanged ? PRIVILEGES_CHANGED : PRIVILEGES_UNCHANGED)[
    metrics.get("PR") ?? ""
  ];
  const confidentiality = IMPACT[metrics.get("C") ?? ""];
  const integrity = IMPACT[metrics.get("I") ?? ""];
  const availability = IMPACT[metrics.get("A") ?? ""];

  const values = [
    attackVector,
    attackComplexity,
    userInteraction,
    privileges,
    confidentiality,
    integrity,
    availability,
  ];
  if (values.some((value) => value === undefined)) {
    return null;
  }

  const impactSubScore =
    1 - (1 - confidentiality) * (1 - integrity) * (1 - availability);

  const impact = scopeChanged
    ? 7.52 * (impactSubScore - 0.029) - 3.25 * Math.pow(impactSubScore - 0.02, 15)
    : 6.42 * impactSubScore;

  if (impact <= 0) {
    return 0;
  }

  const exploitability =
    8.22 * attackVector * attackComplexity * privileges * userInteraction;

  const base = scopeChanged
    ? Math.min(1.08 * (impact + exploitability), 10)
    : Math.min(impact + exploitability, 10);

  return roundUp(base);
}

function roundUp(value: number): number {
  const scaled = Math.round(value * 100000);
  if (scaled % 10000 === 0) {
    return scaled / 100000;
  }
  return (Math.floor(scaled / 10000) + 1) / 10;
}
