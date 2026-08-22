import type { NextRequest } from "next/server";

import { cacheHeaders, cachedPackageReport } from "@/lib/cache";
import { CvtreeError, errorResponse } from "@/lib/errors";
import { latestVersion } from "@/lib/registry";
import { packageReport } from "@/lib/report";
import { repoReport } from "@/lib/repoReport";
import { cacheKey, parseEcosystem, parseQuery, unknownEcosystem } from "@/lib/spec";

export async function GET(request: NextRequest) {
  try {
    const input = request.nextUrl.searchParams.get("q")?.trim();
    if (!input) {
      return Response.json(
        { error: "expected a package such as lodash@4.17.15 in the q parameter" },
        { status: 400 },
      );
    }

    const parsed = parseQuery(input);
    if (!parsed.ok) {
      throw new CvtreeError(parsed.message, 400);
    }

    if (parsed.query.kind === "repo") {
      return Response.json(await repoReport(parsed.query.owner, parsed.query.name));
    }

    const requested = request.nextUrl.searchParams.get("ecosystem");
    const override = requested ? parseEcosystem(requested) : null;
    if (requested && !override) {
      throw new CvtreeError(unknownEcosystem(requested), 400);
    }

    const { name, version, ecosystem } = parsed.query;
    const target = ecosystem ?? override ?? "npm";
    const resolved = version ?? (await latestVersion(name, target));

    const cached = await cachedPackageReport(cacheKey(target, name, resolved), () =>
      packageReport(name, resolved, target),
    );

    return Response.json(cached.report, { headers: cacheHeaders(cached) });
  } catch (error) {
    return errorResponse(error);
  }
}
