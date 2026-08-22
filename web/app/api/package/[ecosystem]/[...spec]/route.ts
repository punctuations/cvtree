import type { NextRequest } from "next/server";

import { proxy } from "@/lib/upstream";

export async function GET(
  _request: NextRequest,
  context: RouteContext<"/api/package/[ecosystem]/[...spec]">,
) {
  const { ecosystem, spec } = await context.params;
  const path = spec.map(encodeURIComponent).join("/");

  return proxy(`/api/package/${encodeURIComponent(ecosystem)}/${path}`);
}
