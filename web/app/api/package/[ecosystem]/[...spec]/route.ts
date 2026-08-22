import type { NextRequest } from "next/server";

import { CvtreeError, errorResponse } from "@/lib/errors";
import { packageReport } from "@/lib/report";
import { parseEcosystem, unknownEcosystem } from "@/lib/spec";

export async function GET(
  _request: NextRequest,
  context: RouteContext<"/api/package/[ecosystem]/[...spec]">,
) {
  try {
    const { ecosystem: requested, spec } = await context.params;

    const ecosystem = parseEcosystem(requested);
    if (!ecosystem) {
      throw new CvtreeError(unknownEcosystem(requested), 400);
    }

    const segments = spec.filter((segment) => segment.length > 0);
    if (segments.length === 0) {
      throw new CvtreeError("expected a package name in the path", 400);
    }

    const name = segments.length > 1 ? segments.slice(0, -1).join("/") : segments[0];
    const version = segments.length > 1 ? segments[segments.length - 1] : null;

    return Response.json(await packageReport(name, version, ecosystem));
  } catch (error) {
    return errorResponse(error);
  }
}
