import type { NextRequest } from "next/server";

import { CvtreeError, errorResponse } from "@/lib/errors";
import { repoReport } from "@/lib/repoReport";
import { parseRepo } from "@/lib/spec";

export async function GET(
  _request: NextRequest,
  context: RouteContext<"/api/repo/[owner]/[name]">,
) {
  try {
    const { owner, name } = await context.params;

    const repo = parseRepo(`${owner}/${name}`);
    if (!repo) {
      throw new CvtreeError(
        `'${owner}/${name}' is not a github repository such as facebook/react`,
        400,
      );
    }

    return Response.json(await repoReport(repo.owner, repo.name));
  } catch (error) {
    return errorResponse(error);
  }
}
