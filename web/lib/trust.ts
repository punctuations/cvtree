export const TRUST_MAX = 4;
export const TRUST_BOXES = 4;
export const STAGES_PER_BOX = 12;

export const TRUST_FLOOR_RATIO = 0.5;

const GREEN = [47, 158, 94] as const;
const YELLOW = [224, 184, 32] as const;
const BLACK = [20, 32, 43] as const;

export function advisoryRatio(advisories: number, versions: number): number | null {
  if (versions <= 0) {
    return null;
  }
  return advisories / versions;
}

export function trustScore(advisories: number, versions: number): number | null {
  const ratio = advisoryRatio(advisories, versions);
  if (ratio === null) {
    return null;
  }

  const penalty = Math.min(ratio, TRUST_FLOOR_RATIO) / TRUST_FLOOR_RATIO;
  return round(TRUST_MAX * (1 - penalty));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function boxStages(score: number): number[] {
  const clamped = Math.min(Math.max(score, 0), TRUST_MAX);

  return Array.from({ length: TRUST_BOXES }, (_, index) =>
    Math.round(Math.min(Math.max(clamped - index, 0), 1) * STAGES_PER_BOX),
  );
}

export function stageColor(stage: number): string {
  const clamped = Math.min(Math.max(stage, 0), STAGES_PER_BOX);
  const half = STAGES_PER_BOX / 2;

  const [from, to, position] =
    clamped >= half
      ? [YELLOW, GREEN, (clamped - half) / half]
      : [BLACK, YELLOW, clamped / half];

  const channels = from.map((value, index) => Math.round(value + (to[index] - value) * position));

  return `rgb(${channels.join(", ")})`;
}

export function trustLabel(score: number | null): string {
  if (score === null) {
    return "unrated";
  }
  if (score >= 3.5) return "solid";
  if (score >= 2.5) return "fair";
  if (score >= 1.5) return "shaky";
  if (score > 0) return "poor";
  return "bad";
}
