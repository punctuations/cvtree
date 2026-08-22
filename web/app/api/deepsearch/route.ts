import type { NextRequest } from "next/server";

import { cacheHeaders, cachedDeepReport } from "@/lib/cache";
import { clampDepth, deepReport } from "@/lib/deepsearch";
import { CvtreeError, errorResponse } from "@/lib/errors";
import { latestVersion } from "@/lib/registry";
import { deepCacheKey, parseEcosystem, parseQuery, unknownEcosystem } from "@/lib/spec";

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  try {
    const input = request.nextUrl.searchParams.get("q")?.trim();
    if (!input) {
      return Response.json(
        { error: "expected a package such as express@4.17.1 in the q parameter" },
        { status: 400 },
      );
    }

    const parsed = parseQuery(input);
    if (!parsed.ok) {
      throw new CvtreeError(parsed.message, 400);
    }

    if (parsed.query.kind === "repo") {
      throw new CvtreeError(
        "deep search takes a package, not a repository, such as express@4.17.1",
        400,
      );
    }

    const requested = request.nextUrl.searchParams.get("ecosystem");
    const override = requested ? parseEcosystem(requested) : null;
    if (requested && !override) {
      throw new CvtreeError(unknownEcosystem(requested), 400);
    }

    const depth = readDepth(request.nextUrl.searchParams.get("depth"));
    const { name, version, ecosystem } = parsed.query;
    const target = ecosystem ?? override ?? "npm";
    const resolved = version ?? (await latestVersion(name, target));

    const cached = await cachedDeepReport(deepCacheKey(target, name, resolved, depth), () =>
      deepReport(name, resolved, target, { depth }),
    );

    return Response.json(cached.report, { headers: cacheHeaders(cached) });
  } catch (error) {
    return errorResponse(error);
  }
}

function readDepth(raw: string | null): number {
  if (raw === null) {
    return clampDepth(null);
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new CvtreeError(`'${raw}' is not a valid depth`, 400);
  }

  return clampDepth(parsed);
}
