import type { NextRequest } from "next/server";

import { proxy } from "@/lib/upstream";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();

  if (!query) {
    return Response.json(
      { error: "expected a package such as lodash@4.17.15 in the q parameter" },
      { status: 400 },
    );
  }

  const forwarded = new URLSearchParams({ q: query });
  const ecosystem = request.nextUrl.searchParams.get("ecosystem");
  if (ecosystem) {
    forwarded.set("ecosystem", ecosystem);
  }

  return proxy(`/api/search?${forwarded.toString()}`);
}
