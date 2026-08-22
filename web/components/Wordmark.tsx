import { pixelRuns } from "@/lib/pixels";
import { CURSIVE_C, CURSIVE_C_HEIGHT, CURSIVE_C_WIDTH } from "@/lib/sprites";

const runs = pixelRuns(CURSIVE_C);

export function Wordmark() {
  return (
    <h1 className="wordmark">
      <span className="visually-hidden">cvtree</span>
      <svg
        className="wordmark-letter"
        viewBox={`0 0 ${CURSIVE_C_WIDTH} ${CURSIVE_C_HEIGHT}`}
        shapeRendering="crispEdges"
        aria-hidden="true"
        focusable="false"
      >
        {runs.map((run) => (
          <rect
            key={`${run.x}-${run.y}`}
            x={run.x}
            y={run.y}
            width={run.length}
            height={1}
          />
        ))}
      </svg>
      <span className="wordmark-rest" aria-hidden="true">
        vtree
      </span>
    </h1>
  );
}
