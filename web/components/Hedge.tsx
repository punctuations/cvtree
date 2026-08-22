import { pixelRuns } from "@/lib/pixels";
import { HEDGE, HEDGE_HEIGHT, HEDGE_WIDTH } from "@/lib/sprites";

const PIXEL = 3;

const FILLS: Record<string, string> = {
  D: "var(--leaf-dark)",
  L: "var(--leaf)",
  S: "var(--stem)",
  P: "var(--path)",
};

const runs = pixelRuns(HEDGE);

export function Hedge({ className }: { className?: string }) {
  return (
    <svg
      className={className ? `hedge ${className}` : "hedge"}
      width="100%"
      height={HEDGE_HEIGHT * PIXEL}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <pattern
          id="hedge-tile"
          patternUnits="userSpaceOnUse"
          width={HEDGE_WIDTH * PIXEL}
          height={HEDGE_HEIGHT * PIXEL}
        >
          {runs.map((run) => (
            <rect
              key={`${run.x}-${run.y}`}
              x={run.x * PIXEL}
              y={run.y * PIXEL}
              width={run.length * PIXEL}
              height={PIXEL}
              fill={FILLS[run.token] ?? "var(--leaf)"}
            />
          ))}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#hedge-tile)" />
    </svg>
  );
}
